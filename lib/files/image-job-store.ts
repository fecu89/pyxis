import { randomUUID } from "node:crypto";
import type { ImageProcessingJob, Prisma } from "@/generated/prisma/client";
import { getPrisma } from "@/lib/prisma";
import { normalizeOriginalFilename } from "@/lib/files/filename";
import type { ImageOutput } from "@/lib/files/image-transform";

export class ImageJobBusyError extends Error {
  readonly status = 503;
  constructor() { super("이미지 업로드가 몰려 있습니다. 잠시 후 다시 시도해 주세요."); }
}
export const backgroundImagesEnabled = () => process.env.PAD_BACKGROUND_IMAGES_ENABLED === "true";
export function retryDelayMs(attempt: number) { return [5000, 30000, 120000, 600000][attempt - 1] ?? null; }
export type ImageJobClaim = ImageProcessingJob & { leaseToken: string };

export async function enqueueImageJob(tx: Prisma.TransactionClient,
  input: { attachmentId: string; boardId: string; postId: string; inputPath: string }) {
  // Serialize capacity decisions across processes, not merely a local JS counter.
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(825417301)`;
  if (await tx.imageProcessingJob.count({ where: { status: { not: "DONE" } } }) >= 256) throw new ImageJobBusyError();
  await tx.imageProcessingJob.create({ data: input });
}

export async function claimImageJob(now: Date): Promise<ImageJobClaim | null> {
  return getPrisma().$transaction(async tx => {
    await tx.imageProcessingJob.updateMany({
      where: { status: "PROCESSING", leaseExpiresAt: { lte: now }, attempts: { gte: 5 } },
      data: { status: "FAILED", leaseToken: null, leaseExpiresAt: null, lastErrorCode: "lease-exhausted" },
    });
    const candidates = await tx.$queryRaw<{ id: string }[]>`
      SELECT "id" FROM "ImageProcessingJob"
      WHERE ("status" = 'PENDING' AND "availableAt" <= ${now})
         OR ("status" = 'PROCESSING' AND "leaseExpiresAt" <= ${now} AND "attempts" < 5)
      ORDER BY "availableAt", "id" FOR UPDATE SKIP LOCKED LIMIT 1`;
    if (!candidates.length) return null;
    const leaseToken = randomUUID();
    const job = await tx.imageProcessingJob.update({ where: { id: candidates[0].id }, data: {
      status: "PROCESSING", leaseToken, leaseExpiresAt: new Date(now.getTime() + 120000), attempts: { increment: 1 },
    } });
    return { ...job, leaseToken };
  });
}
export async function renewImageJob(claim: ImageJobClaim, now: Date) {
  const result = await getPrisma().imageProcessingJob.updateMany({
    where: { id: claim.id, status: "PROCESSING", leaseToken: claim.leaseToken, leaseExpiresAt: { gt: now } },
    data: { leaseExpiresAt: new Date(now.getTime() + 120000) },
  });
  return result.count === 1;
}
export async function failImageJob(claim: ImageJobClaim, code: string, now: Date) {
  const delay = retryDelayMs(claim.attempts);
  await getPrisma().imageProcessingJob.updateMany({
    where: { id: claim.id, status: "PROCESSING", leaseToken: claim.leaseToken, leaseExpiresAt: { gt: now } },
    data: { status: delay === null ? "FAILED" : "PENDING", availableAt: new Date(now.getTime() + (delay ?? 0)),
      leaseToken: null, leaseExpiresAt: null, lastErrorCode: code.slice(0, 64) },
  });
}

/** Lock ancestors in a consistent order with board purge. No locks during encoding. */
export async function lockImageTarget(tx: Prisma.TransactionClient, claim: { boardId: string; postId: string; attachmentId: string }) {
  await tx.$queryRaw`SELECT "id" FROM "Board" WHERE "id" = ${claim.boardId} FOR UPDATE`;
  await tx.$queryRaw`SELECT s."id" FROM "Section" s JOIN "Post" p ON p."sectionId" = s."id" WHERE p."id" = ${claim.postId} FOR UPDATE OF s`;
  await tx.$queryRaw`SELECT "id" FROM "Post" WHERE "id" = ${claim.postId} FOR UPDATE`;
  await tx.$queryRaw`SELECT "id" FROM "Attachment" WHERE "id" = ${claim.attachmentId} FOR UPDATE`;
}

export async function commitImageJob(claim: ImageJobClaim, output: ImageOutput, now: Date) {
  return getPrisma().$transaction(async tx => {
    await lockImageTarget(tx, claim);
    await tx.$queryRaw`SELECT "id" FROM "ImageProcessingJob" WHERE "id" = ${claim.id} FOR UPDATE`;
    const current = await tx.imageProcessingJob.findUnique({ where: { id: claim.id } });
    if (!current || current.status !== "PROCESSING" || current.leaseToken !== claim.leaseToken
      || !current.leaseExpiresAt || current.leaseExpiresAt <= now) return false;
    const attachment = await tx.attachment.findFirst({ where: {
      id: claim.attachmentId, deletedAt: null, storagePath: claim.inputPath,
      post: { deletedAt: null, board: { deletedAt: null }, OR: [{ sectionId: null }, { section: { deletedAt: null } }] },
    } });
    if (!attachment) {
      await tx.imageProcessingJob.update({ where: { id: claim.id }, data: {
        status: "CLEANUP_PENDING", cleanupAfter: now, leaseToken: null, leaseExpiresAt: null,
      } });
      return false;
    }
    await tx.attachment.update({ where: { id: attachment.id }, data: {
      ...output, mimeType: "image/webp", originalName: normalizeOriginalFilename(attachment.originalName, ".webp"),
      imageRevision: { increment: 1 },
    } });
    await tx.imageProcessingJob.update({ where: { id: claim.id }, data: {
      status: "CLEANUP_PENDING", outputPath: output.storagePath, thumbnailPath: output.thumbnailPath,
      cleanupAfter: new Date(now.getTime() + 60000), leaseToken: null, leaseExpiresAt: null, lastErrorCode: null,
    } });
    return true;
  });
}

export async function cancelAttachmentImageJobs(attachmentIds: string[]) {
  if (!attachmentIds.length) return;
  await getPrisma().imageProcessingJob.updateMany({ where: { attachmentId: { in: attachmentIds } },
    data: { status: "CLEANUP_PENDING", cleanupAfter: new Date(), leaseToken: null, leaseExpiresAt: null } });
}
