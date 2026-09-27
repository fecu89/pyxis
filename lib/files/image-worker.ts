import path from "node:path";
import { getPrisma } from "@/lib/prisma";
import { backgroundImagesEnabled, claimImageJob, renewImageJob, failImageJob, commitImageJob, cancelAttachmentImageJobs, lockImageTarget } from "@/lib/files/image-job-store";
import { transformImage } from "@/lib/files/image-transform";
import { cleanupImageJobs, unlinkImageFile, sweepImageOrphans } from "@/lib/files/image-job-cleanup";
import { publishBoardEvent } from "@/lib/realtime/board-events";

export async function runImageJobOnce(now = new Date()) {
  const claim = await claimImageJob(now);
  if (!claim) return false;
  const db = getPrisma();
  const alive = await db.attachment.findFirst({ where: { id: claim.attachmentId, deletedAt: null,
    post: { deletedAt: null, board: { deletedAt: null }, OR: [{ sectionId: null }, { section: { deletedAt: null } }] } }, select: { id: true } });
  if (!alive) { await cancelAttachmentImageJobs([claim.attachmentId]); return true; }
  const stem = path.posix.join(path.posix.dirname(claim.inputPath), `optimized-${claim.leaseToken}`);
  const outputs = [`${stem}.webp`, `${stem}.thumb.webp`];
  const registered = await db.imageProcessingJob.updateMany({
    where: { id: claim.id, status: "PROCESSING", leaseToken: claim.leaseToken, leaseExpiresAt: { gt: new Date() } },
    data: { outputPath: outputs[0], thumbnailPath: outputs[1] },
  });
  if (!registered.count) return true;
  const heartbeat = setInterval(() => { void renewImageJob(claim, new Date()).catch(() => undefined); }, 20000);
  heartbeat.unref();
  try {
    const output = await transformImage(claim.inputPath, stem);
    const committed = await commitImageJob(claim, output, new Date());
    if (!committed) for (const file of outputs) await unlinkImageFile(file);
    if (committed) {
      // The representation is already committed. Hold the target locks through
      // synchronous publication so deletion cannot publish before this snapshot.
      await db.$transaction(async tx => {
        await lockImageTarget(tx, claim);
        const attachment = await tx.attachment.findUnique({ where: { id: claim.attachmentId,
          deletedAt: null, post: { deletedAt: null, board: { deletedAt: null },
            OR: [{ sectionId: null }, { section: { deletedAt: null } }] } }, select: {
          id: true, originalName: true, mimeType: true, fileSize: true, width: true, height: true, imageRevision: true,
          type: true, altText: true, caption: true, externalUrl: true, previewImageUrl: true,
          deletedAt: true, post: { select: { status: true, authorId: true, guestId: true, deletedAt: true } },
        } });
        if (attachment && !attachment.deletedAt && !attachment.post.deletedAt) {
          const { post, deletedAt: _deletedAt, ...snapshot } = attachment;
          const attachmentPatch = { id: snapshot.id, originalName: snapshot.originalName, mimeType: snapshot.mimeType,
            fileSize: snapshot.fileSize, width: snapshot.width, height: snapshot.height, imageRevision: snapshot.imageRevision };
          void _deletedAt;
          publishBoardEvent(claim.boardId, { type: "attachment.updated", entityId: claim.attachmentId, postId: claim.postId,
            payload: { attachment: snapshot, attachmentPatch }, delivery: { public: post.status === "PUBLISHED", authorUserId: post.authorId, authorGuestId: post.guestId } });
        }
      });
    }
  } catch {
    // A DB commit may have succeeded even if its acknowledgement failed: never blindly delete outputs.
    for (const file of outputs) {
      const referenced = await db.attachment.count({ where: { OR: [{ storagePath: file }, { thumbnailPath: file }] } }).catch(() => 1);
      if (!referenced) await unlinkImageFile(file).catch(() => undefined);
    }
    await failImageJob(claim, "conversion-failed", new Date());
    console.warn("[pad-image] conversion-retry", { jobId: claim.id, attempt: claim.attempts });
  } finally { clearInterval(heartbeat); }
  return true;
}

const globalWorker = globalThis as unknown as { pyxisPadImageWorker?: { stop(): Promise<void> } };
export function startPadImageWorker() {
  if (globalWorker.pyxisPadImageWorker) return globalWorker.pyxisPadImageWorker;
  let stopped = false;
  let timer: NodeJS.Timeout | undefined;
  let active: Promise<void> = Promise.resolve();
  let lastSweep = 0;
  async function tick() {
    if (backgroundImagesEnabled()) {
      try {
        // One background conversion at a time leaves room in the shared gate for interactive consumers.
        await runImageJobOnce();
        await cleanupImageJobs(new Date());
        if (Date.now() - lastSweep > 3600000) { await sweepImageOrphans(new Date()); lastSweep = Date.now(); }
      } catch { console.warn("[pad-image] worker-retry"); }
    }
    if (!stopped) { timer = setTimeout(() => { active = tick(); }, 2000); timer.unref(); }
  }
  const worker = { async stop() {
    stopped = true; if (timer) clearTimeout(timer);
    let timeout: NodeJS.Timeout | undefined;
    await Promise.race([active, new Promise<void>(resolve => { timeout = setTimeout(resolve, 10000); timeout.unref(); })]);
    if (timeout) clearTimeout(timeout);
    delete globalWorker.pyxisPadImageWorker;
  } };
  globalWorker.pyxisPadImageWorker = worker;
  timer = setTimeout(() => { active = tick(); }, 2000); timer.unref();
  return worker;
}
