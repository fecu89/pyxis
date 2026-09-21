import { readdir, rm, rmdir } from "node:fs/promises";
import path from "node:path";
import { getQuizUploadDirectory, getUploadRoot } from "@/lib/files/paths";
import { getPrisma } from "@/lib/prisma";
import {
  pruneUnreferencedQuizImages,
  QUIZ_IMAGE_PRUNE_GRACE_MS,
  withQuizImageLock,
} from "@/lib/quiz/image-maintenance";

function isFileSystemError(error: unknown, code: string): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error && error.code === code;
}

export async function sweepUnreferencedQuizImages(
  options: { now?: number; graceMs?: number; deletedQuizPurgeDays?: number } = {},
) {
  const root = path.join(getUploadRoot(), "quiz");
  let entries;
  try {
    entries = await readdir(/* turbopackIgnore: true */ root, { withFileTypes: true });
  } catch (error) {
    if (isFileSystemError(error, "ENOENT")) return { scanned: 0, removed: 0, purgedQuizzes: 0 };
    throw error;
  }

  const prisma = getPrisma();
  let scanned = 0;
  let removed = 0;
  let purgedQuizzes = 0;
  const now = options.now ?? Date.now();
  const purgeDays = options.deletedQuizPurgeDays ?? deletedQuizPurgeDays();
  const purgeBefore = purgeDays > 0 ? new Date(now - purgeDays * 24 * 60 * 60_000) : null;
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    try {
      getQuizUploadDirectory(entry.name);
    } catch {
      continue;
    }

    scanned += 1;
    await withQuizImageLock(entry.name, async () => {
      const quiz = await prisma.quiz.findUnique({
        where: { id: entry.name },
        select: {
          deletedAt: true,
          thumbnailUrl: true,
          questions: { select: { imageUrl: true } },
          _count: { select: { sessions: true } },
        },
      });
      // 복원 경로가 없고 응시 이력도 없는 오래된 삭제 퀴즈만 영구 정리합니다. 세션이 있으면
      // 과거 리포트가 문항과 이미지를 계속 읽으므로 기간과 관계없이 보존합니다.
      if (quiz?.deletedAt && purgeBefore && quiz.deletedAt <= purgeBefore && quiz._count.sessions === 0) {
        await prisma.quiz.delete({ where: { id: entry.name } });
        await rm(/* turbopackIgnore: true */ getQuizUploadDirectory(entry.name), { recursive: true, force: true });
        purgedQuizzes += 1;
        return;
      }
      const references = quiz
        ? [quiz.thumbnailUrl, ...quiz.questions.map((question) => question.imageUrl)]
        : [];
      removed += await pruneUnreferencedQuizImages(entry.name, references, {
        now,
        graceMs: options.graceMs ?? QUIZ_IMAGE_PRUNE_GRACE_MS,
      });

      if (!quiz) {
        try {
          await rmdir(/* turbopackIgnore: true */ getQuizUploadDirectory(entry.name));
        } catch (error) {
          if (!isFileSystemError(error, "ENOENT") && !isFileSystemError(error, "ENOTEMPTY")) throw error;
        }
      }
    });
  }
  return { scanned, removed, purgedQuizzes };
}

const globalForSweep = globalThis as unknown as {
  pyxQuizImageSweepTimer?: NodeJS.Timeout;
  pyxQuizImageSweepRunning?: boolean;
};

function sweepIntervalMs() {
  const configured = Number(process.env.QUIZ_IMAGE_SWEEP_INTERVAL_HOURS ?? "6");
  const hours = Number.isFinite(configured) ? Math.min(24, Math.max(1, configured)) : 6;
  return hours * 60 * 60_000;
}

function deletedQuizPurgeDays() {
  const configured = Number(process.env.QUIZ_DELETED_PURGE_DAYS ?? "90");
  if (!Number.isFinite(configured) || configured < 0) return 90;
  if (configured === 0) return 0;
  return Math.min(3650, Math.max(7, Math.floor(configured)));
}

/** Node 서버 프로세스마다 하나만 실행되는 저빈도 정리 작업입니다. */
export function startQuizImageSweeper() {
  if (globalForSweep.pyxQuizImageSweepTimer) return;

  const schedule = (delayMs: number) => {
    globalForSweep.pyxQuizImageSweepTimer = setTimeout(async () => {
      globalForSweep.pyxQuizImageSweepTimer = undefined;
      if (!globalForSweep.pyxQuizImageSweepRunning) {
        globalForSweep.pyxQuizImageSweepRunning = true;
        try {
          const result = await sweepUnreferencedQuizImages();
          if (result.removed > 0 || result.purgedQuizzes > 0) {
            console.info(`[quiz-image-sweep] removed=${result.removed} purged_quizzes=${result.purgedQuizzes} scanned=${result.scanned}`);
          }
        } catch (error) {
          console.warn("[quiz-image-sweep] failed", error);
        } finally {
          globalForSweep.pyxQuizImageSweepRunning = false;
        }
      }
      schedule(sweepIntervalMs());
    }, delayMs);
    globalForSweep.pyxQuizImageSweepTimer.unref();
  };

  schedule(60_000);
}
