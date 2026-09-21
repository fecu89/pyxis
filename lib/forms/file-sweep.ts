import { removeStoredAttachmentFiles } from "@/lib/files/cleanup";
import { getPrisma } from "@/lib/prisma";

const PENDING_TTL_MS = 24 * 60 * 60 * 1000;
const SWEEP_INTERVAL_MS = 60 * 60 * 1000;

export async function sweepPendingFormFiles(now = new Date()) {
  const files = await getPrisma().formUploadedFile.findMany({
    where: { answerId: null, createdAt: { lt: new Date(now.getTime() - PENDING_TTL_MS) } },
    take: 500,
    select: { id: true, storagePath: true, thumbnailPath: true },
  });
  if (!files.length) return 0;
  await removeStoredAttachmentFiles(files);
  await getPrisma().formUploadedFile.deleteMany({ where: { id: { in: files.map((file) => file.id) }, answerId: null } });
  return files.length;
}

let started = false;
export function startFormFileSweeper() {
  if (started) return;
  started = true;
  const schedule = (delay: number) => {
    const timer = setTimeout(async () => {
      try { await sweepPendingFormFiles(); }
      catch (error) { console.error("form file sweep failed", error); }
      finally { schedule(SWEEP_INTERVAL_MS); }
    }, delay);
    timer.unref();
  };
  schedule(10 * 60_000);
}
