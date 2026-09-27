import { unlink, readdir, lstat } from "node:fs/promises";
import path from "node:path";
import { getPrisma } from "@/lib/prisma";
import { resolveStoredFile, getUploadRoot, toStoragePath } from "@/lib/files/paths";
import { lockImageTarget } from "@/lib/files/image-job-store";

export async function unlinkImageFile(storagePath: string) {
  try { await unlink(/* turbopackIgnore: true */ resolveStoredFile(storagePath)); }
  catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
}

export async function cleanupImageJobs(now: Date) {
  const db = getPrisma();
  // Orphaned jobs survive cascades so a restart can still reclaim their files.
  await db.$executeRaw`UPDATE "ImageProcessingJob" j SET "status" = 'CLEANUP_PENDING',
    "cleanupAfter" = ${now}, "leaseToken" = NULL, "leaseExpiresAt" = NULL
    WHERE j."status" NOT IN ('CLEANUP_PENDING','DONE') AND NOT EXISTS
    (SELECT 1 FROM "Attachment" a WHERE a."id" = j."attachmentId")`;
  const jobs = await db.imageProcessingJob.findMany({ where: { status: "CLEANUP_PENDING", cleanupAfter: { lte: now } }, take: 50, orderBy: { cleanupAfter: "asc" } });
  for (const job of jobs) {
    try {
      await db.$transaction(async tx => {
        await lockImageTarget(tx, job);
        await tx.$queryRaw`SELECT "id" FROM "ImageProcessingJob" WHERE "id" = ${job.id} FOR UPDATE`;
        const current = await tx.imageProcessingJob.findUnique({ where: { id: job.id } });
        if (!current || current.status !== "CLEANUP_PENDING" || !current.cleanupAfter || current.cleanupAfter > now) return;
        for (const file of new Set([current.inputPath, current.outputPath, current.thumbnailPath].filter((v): v is string => Boolean(v)))) {
          // Include soft-deleted rows: restore and copy must not lose a referenced representation.
          if (await tx.attachment.count({ where: { OR: [{ storagePath: file }, { thumbnailPath: file }] } })) continue;
          await unlinkImageFile(file);
          await unlinkImageFile(`${file}.uploading`);
        }
        await tx.imageProcessingJob.update({ where: { id: job.id }, data: { status: "DONE" } });
      });
    } catch {
      // Retry cleanup separately; don't reconvert or expose filesystem/user information in logs.
      console.warn("[pad-image] cleanup-retry", { jobId: job.id });
    }
  }
}

/** Only files owned by this pipeline, older than an hour, never symbolic links. */
export async function sweepImageOrphans(now: Date) {
  const db = getPrisma();
  async function walk(directory: string): Promise<void> {
    const entries = await readdir(/* turbopackIgnore: true */ directory, { withFileTypes: true }).catch(() => []);
    for (const entry of entries) {
      if (entry.isSymbolicLink()) continue;
      const file = path.join(/* turbopackIgnore: true */ directory, entry.name);
      if (entry.isDirectory()) { await walk(file); continue; }
      if (!/^(pending-[0-9a-f-]+\.(jpg|png|webp)|optimized-[0-9a-f-]+\.(webp|thumb\.webp)(\.uploading)?)$/.test(entry.name)) continue;
      const info = await lstat(/* turbopackIgnore: true */ file).catch(() => null);
      if (!info?.isFile() || info.mtimeMs > now.getTime() - 3600000) continue;
      const stored = toStoragePath(file);
      if (await db.attachment.count({ where: { OR: [{ storagePath: stored }, { thumbnailPath: stored }] } })) continue;
      const completed = stored.replace(/\.uploading$/, "");
      if (await db.imageProcessingJob.count({ where: { status: { not: "DONE" }, OR: [
        { inputPath: completed }, { outputPath: completed }, { thumbnailPath: completed },
      ] } })) continue;
      await unlinkImageFile(stored);
    }
  }
  await walk(path.join(/* turbopackIgnore: true */ getUploadRoot(), "boards"));
}
