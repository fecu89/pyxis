import { readdir, stat, unlink } from "node:fs/promises";
import { getQuizImagePath, getQuizUploadDirectory, isQuizImageName } from "@/lib/files/paths";

const globalForQuizImages = globalThis as unknown as {
  pyxQuizImageLocks?: Map<string, Promise<void>>;
};
const quizImageLocks = globalForQuizImages.pyxQuizImageLocks ?? new Map<string, Promise<void>>();
globalForQuizImages.pyxQuizImageLocks = quizImageLocks;

function isFileSystemError(error: unknown, code: string): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error && error.code === code;
}

/** 단일 인스턴스의 같은 퀴즈에서 업로드·저장·정리가 서로 파일을 지우지 않도록 직렬화합니다. */
export async function withQuizImageLock<T>(quizId: string, task: () => Promise<T>) {
  const waitFor = quizImageLocks.get(quizId) ?? Promise.resolve();
  let release!: () => void;
  const hold = new Promise<void>((resolve) => { release = resolve; });
  const tail = waitFor.then(() => hold);
  quizImageLocks.set(quizId, tail);
  await waitFor;
  try {
    return await task();
  } finally {
    release();
    if (quizImageLocks.get(quizId) === tail) quizImageLocks.delete(quizId);
  }
}

/** 내부 이미지 주소에서 퀴즈 ID와 안전한 UUID 파일명을 되뽑습니다. */
export function parseQuizImageUrl(url: string | null | undefined) {
  if (!url) return null;
  const matched = /^\/api\/quiz\/quizzes\/([A-Za-z0-9-]+)\/images\/([A-Za-z0-9-]+\.(?:webp|jpg))$/i.exec(url);
  if (!matched) return null;
  const [, quizId, name] = matched;
  if (!isQuizImageName(name)) return null;
  return { quizId, name };
}

/** 저장 전 편집 중인 이미지가 다른 탭의 저장에 지워지지 않도록 두는 시간입니다. */
export const QUIZ_IMAGE_PRUNE_GRACE_MS = 24 * 60 * 60_000;

export async function pruneUnreferencedQuizImages(
  quizId: string,
  referencedUrls: (string | null | undefined)[],
  options: { now?: number; graceMs?: number } = {},
) {
  const keep = new Set<string>();
  for (const url of referencedUrls) {
    const parsed = parseQuizImageUrl(url);
    if (parsed && parsed.quizId === quizId) keep.add(parsed.name);
  }

  let entries: string[];
  try {
    entries = await readdir(/* turbopackIgnore: true */ getQuizUploadDirectory(quizId));
  } catch (error) {
    if (isFileSystemError(error, "ENOENT")) return 0;
    throw error;
  }

  const now = options.now ?? Date.now();
  const graceMs = options.graceMs ?? QUIZ_IMAGE_PRUNE_GRACE_MS;
  let removed = 0;
  for (const entry of entries) {
    if (!isQuizImageName(entry) || keep.has(entry)) continue;
    const filePath = getQuizImagePath(quizId, entry);
    let info;
    try {
      info = await stat(/* turbopackIgnore: true */ filePath);
    } catch (error) {
      if (isFileSystemError(error, "ENOENT")) continue;
      throw error;
    }
    if (now - info.mtimeMs < graceMs) continue;
    try {
      await unlink(/* turbopackIgnore: true */ filePath);
      removed += 1;
    } catch (error) {
      if (!isFileSystemError(error, "ENOENT")) throw error;
    }
  }
  return removed;
}
