import { removeBoardUploadDirectory, removeStoredAttachmentFiles, type StoredAttachmentFiles } from "@/lib/files/cleanup";
import { padTrashCutoff } from "@/lib/board/trash-policy";
import { getPrisma } from "@/lib/prisma";
import { cancelAttachmentImageJobs } from "@/lib/files/image-job-store";

type DeletedAttachment = StoredAttachmentFiles & { id: string };

const ATTACHMENT_BATCH_SIZE = 500;
const ENTITY_BATCH_SIZE = 200;
const SWEEP_INTERVAL_MS = 7 * 24 * 60 * 60 * 1_000;

/**
 * 파일을 먼저 지우고, 전부 성공했을 때만 재시도 표식인 Attachment 행을 제거합니다.
 * 일부 파일이 실패하면 행을 남겨 다음 즉시 삭제 요청이나 주간 sweep가 다시 시도합니다.
 */
export async function purgeDeletedPadAttachments(attachments: DeletedAttachment[]) {
  if (!attachments.length) return { purged: 0, removed: 0, missing: 0, failed: 0 };
  await cancelAttachmentImageJobs(attachments.map(item => item.id));
  const cleanup = await removeStoredAttachmentFiles(attachments);
  if (cleanup.failed) return { purged: 0, ...cleanup };

  const ids = attachments.map((attachment) => attachment.id);
  const deleted = await getPrisma().attachment.deleteMany({
    where: { id: { in: ids }, deletedAt: { not: null } },
  });
  return { purged: deleted.count, ...cleanup };
}

async function purgeArchivedBoards(cutoff: Date) {
  const prisma = getPrisma();
  const boards = await prisma.board.findMany({
    where: { deletedAt: { lte: cutoff } },
    orderBy: { id: "asc" },
    take: ENTITY_BATCH_SIZE,
    select: { id: true },
  });
  let purged = 0;
  let failed = 0;
  for (const board of boards) {
    const outcome = await prisma.$transaction(async (tx) => {
      // 7일 경계에서 복구 요청과 겹쳐도 복구된 패드의 파일을 지우지 않도록 Board 행을 먼저
      // 잠급니다. 복구가 먼저 끝났다면 조건이 다시 평가되어 빈 배열이 됩니다.
      const locked = await tx.$queryRaw<Array<{ activityId: string }>>`
        SELECT "activityId" FROM "Board"
        WHERE "id" = ${board.id} AND "deletedAt" <= ${cutoff}
        FOR UPDATE
      `;
      if (!locked.length) return "skipped" as const;
      // 패드 전용 디렉터리를 통째로 제거하면 배경과 DB 참조를 잃은 고아 파일도 함께
      // 정리됩니다. 실패하면 트랜잭션은 DB를 보존하고 다음 sweep에서 다시 시도합니다.
      if (!(await removeBoardUploadDirectory(board.id))) return "failed" as const;
      const deleted = await tx.activity.deleteMany({ where: { id: locked[0].activityId } });
      return deleted.count ? "purged" as const : "failed" as const;
    });
    if (outcome === "purged") purged += 1;
    if (outcome === "failed") failed += 1;
  }
  return { scanned: boards.length, purged, failed };
}

async function purgeRetryAttachments() {
  const attachments = await getPrisma().attachment.findMany({
    where: { deletedAt: { not: null } },
    orderBy: { id: "asc" },
    take: ATTACHMENT_BATCH_SIZE,
    select: { id: true, storagePath: true, thumbnailPath: true },
  });
  return { scanned: attachments.length, ...(await purgeDeletedPadAttachments(attachments)) };
}

async function purgeExpiredComments(cutoff: Date) {
  const prisma = getPrisma();
  const comments = await prisma.comment.findMany({
    where: { deletedAt: { lte: cutoff }, post: { deletedAt: null, board: { deletedAt: null } } },
    orderBy: { id: "asc" },
    take: ENTITY_BATCH_SIZE,
    select: { id: true },
  });
  if (!comments.length) return 0;
  const ids = comments.map((comment) => comment.id);
  await prisma.$transaction(async (tx) => {
    // 답글 자체는 삭제 대상이 아닐 수 있으므로, 삭제할 부모와의 연결만 끊습니다.
    await tx.comment.updateMany({ where: { parentId: { in: ids } }, data: { parentId: null } });
    await tx.comment.deleteMany({ where: { id: { in: ids }, deletedAt: { lte: cutoff } } });
  });
  return ids.length;
}

async function purgeExpiredPosts(cutoff: Date) {
  const prisma = getPrisma();
  const posts = await prisma.post.findMany({
    where: { deletedAt: { lte: cutoff }, board: { deletedAt: null } },
    orderBy: { id: "asc" },
    take: ENTITY_BATCH_SIZE,
    select: {
      id: true,
      attachments: { select: { id: true, storagePath: true, thumbnailPath: true } },
    },
  });
  let purged = 0;
  for (const post of posts) {
    if (post.attachments.length) {
      await prisma.attachment.updateMany({ where: { postId: post.id }, data: { deletedAt: new Date() } });
      const cleanup = await purgeDeletedPadAttachments(post.attachments);
      if (cleanup.failed) continue;
    }
    const deleted = await prisma.post.deleteMany({ where: { id: post.id, deletedAt: { lte: cutoff } } });
    purged += deleted.count;
  }
  return purged;
}

async function purgeExpiredSections(cutoff: Date) {
  const prisma = getPrisma();
  const sections = await prisma.section.findMany({
    where: { deletedAt: { lte: cutoff }, board: { deletedAt: null } },
    orderBy: { id: "asc" },
    take: ENTITY_BATCH_SIZE,
    select: { id: true },
  });
  if (!sections.length) return 0;
  const ids = sections.map((section) => section.id);
  const deleted = await prisma.section.deleteMany({
    where: { id: { in: ids }, deletedAt: { lte: cutoff }, posts: { none: {} } },
  });
  return deleted.count;
}

export async function sweepPadTrash(now = new Date()) {
  const cutoff = padTrashCutoff(now);
  // 보드부터 지우면 하위 행은 cascade되고 디렉터리 전체가 정리되어 나머지 배치가 작아집니다.
  const boards = await purgeArchivedBoards(cutoff);
  const attachments = await purgeRetryAttachments();
  const comments = await purgeExpiredComments(cutoff);
  const posts = await purgeExpiredPosts(cutoff);
  const sections = await purgeExpiredSections(cutoff);
  return { cutoff, boards, attachments, comments, posts, sections };
}

const globalForSweep = globalThis as unknown as {
  pyxPadTrashSweepTimer?: NodeJS.Timeout;
  pyxPadTrashSweepRunning?: boolean;
};

/** 서버 시작 1분 뒤 한 번 정리하고, 이후 7일마다 실행합니다. */
export function startPadTrashSweeper() {
  if (globalForSweep.pyxPadTrashSweepTimer) return;
  const schedule = (delayMs: number) => {
    globalForSweep.pyxPadTrashSweepTimer = setTimeout(async () => {
      globalForSweep.pyxPadTrashSweepTimer = undefined;
      if (!globalForSweep.pyxPadTrashSweepRunning) {
        globalForSweep.pyxPadTrashSweepRunning = true;
        try {
          const result = await sweepPadTrash();
          const changed = result.boards.purged + result.attachments.purged + result.comments + result.posts + result.sections;
          if (changed || result.attachments.failed || result.boards.failed) {
            console.info(`[pad-trash-sweep] purged=${changed} files_removed=${result.attachments.removed} file_failures=${result.attachments.failed} board_failures=${result.boards.failed}`);
          }
        } catch (error) {
          console.warn("[pad-trash-sweep] failed", error);
        } finally {
          globalForSweep.pyxPadTrashSweepRunning = false;
        }
      }
      schedule(SWEEP_INTERVAL_MS);
    }, delayMs);
    globalForSweep.pyxPadTrashSweepTimer.unref();
  };
  schedule(60_000);
}
