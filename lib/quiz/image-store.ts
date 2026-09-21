import "server-only";

import { mkdir, copyFile, readdir, rename, rm, stat, unlink } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import path from "node:path";
import sharp from "sharp";
import { streamMultipartFile } from "@/lib/files/multipart";
import { getQuizImagePath, getQuizUploadDirectory, isQuizImageName } from "@/lib/files/paths";
import { withImageProcessingSlot } from "@/lib/files/processing-queue";
import { getUploadPolicy, mb } from "@/lib/files/upload-policy";
import { validateUploadedFile } from "@/lib/files/validation";
import { parseQuizImageUrl, withQuizImageLock } from "@/lib/quiz/image-maintenance";

export {
  parseQuizImageUrl,
  pruneUnreferencedQuizImages,
  QUIZ_IMAGE_PRUNE_GRACE_MS,
  withQuizImageLock,
} from "@/lib/quiz/image-maintenance";

// 퀴즈 이미지는 예전에 base64 data URL로 DB(Question.imageUrl / Quiz.thumbnailUrl)에 들어갔습니다.
// 지금은 패드 첨부와 같은 규칙 — 로컬 디스크에 두고 컬럼에는 주소만 담습니다. 컬럼 타입이
// String? 그대로라 값을 소비하는 쪽(<img src>, 소켓 브로드캐스트, 리포트, 클론)은 손댈 게 없습니다.
//
// 원본 크기를 그대로 담던 시절의 부담(목록 RSC 페이로드·question:show 브로드캐스트마다 같은
// 바이트가 복제되던 문제)은 주소만 오가면서 자연히 사라집니다. 대신 참여자가 이미지를 따로
// 받아가므로 서빙 라우트가 접근 판정을 합니다.

// 상한은 관리 페이지 → 정책 탭에서 정합니다(lib/files/upload-policy.ts). 예전에는 여기 상수와
// MAX_QUIZ_IMAGE_STORAGE_MB 환경 변수로 나뉘어 있어 바꾸려면 재배포가 필요했습니다.
export async function maxQuizImageBytes() {
  const policy = await getUploadPolicy();
  return mb(Math.min(policy.maxQuizImageMb, policy.maxUploadMb));
}

const MAX_QUIZ_IMAGE_EDGE = 1600;
const MAX_QUIZ_THUMBNAIL_EDGE = 800;

/** 업로드를 받아 낼 수 있는 이미지 확장자. 시그니처는 sharp가 실제로 디코드하며 다시 검증합니다. */
const ALLOWED_EXTENSIONS = new Set([".jpg", ".jpeg", ".png", ".webp", ".gif"]);

/** 한 퀴즈가 파일 업로드만으로 디스크를 무한히 차지하지 못하게 하는 완성 이미지 총량입니다. */
export async function maxQuizImageStorageBytes() {
  return mb((await getUploadPolicy()).maxQuizImageStorageMb);
}

export class QuizImageStorageLimitError extends Error {
  readonly status = 413;

  // 상한을 인자로 받습니다. 정책이 DB에 있어 읽기가 비동기가 됐고, 생성자에서는 기다릴 수
  // 없습니다. 메시지에 실제 적용된 값이 나와야 사용자가 무엇을 줄여야 하는지 압니다.
  constructor(limitBytes: number) {
    super(`퀴즈 하나에는 이미지를 최대 ${Math.floor(limitBytes / 1024 / 1024)}MB까지 저장할 수 있습니다.`);
    this.name = "QuizImageStorageLimitError";
  }
}

function isFileSystemError(error: unknown, code: string): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error && error.code === code;
}

export function quizImageUrl(quizId: string, name: string) {
  return `/api/quiz/quizzes/${quizId}/images/${name}`;
}

/** 파일 이름에서 응답 Content-Type을 정합니다. 확장자는 우리가 붙인 둘 중 하나뿐입니다. */
export function quizImageContentType(name: string) {
  return name.toLowerCase().endsWith(".jpg") ? "image/jpeg" : "image/webp";
}

/**
 * multipart 본문 하나를 받아 WebP로 재인코딩해 저장하고 주소를 돌려줍니다.
 *
 * 재인코딩은 크기 때문만이 아닙니다 — sharp가 실제로 디코드하지 못하는 바이트는 여기서
 * 걸리므로, 이미지로 위장한 HTML/스크립트가 우리 출처에서 서비스되는 일이 없습니다.
 * (예전 클라이언트 canvas 압축은 브라우저가 보낸 MIME만 믿었습니다.)
 */
export async function storeQuizImage(request: Request, quizId: string, options: { thumbnail?: boolean } = {}) {
  return withQuizImageLock(quizId, () => storeQuizImageUnlocked(request, quizId, options));
}

async function storeQuizImageUnlocked(request: Request, quizId: string, options: { thumbnail?: boolean }) {
  const directory = getQuizUploadDirectory(quizId);
  await mkdir(/* turbopackIgnore: true */ directory, { recursive: true });

  let incomingPath: string | null = null;
  let processingPath: string | null = null;
  let storedPath: string | null = null;
  let committed = false;
  try {
    const perImageLimit = await maxQuizImageBytes();
    const uploaded = await streamMultipartFile(request, directory, perImageLimit);
    incomingPath = uploaded.temporaryPath;
    const extension = path.extname(uploaded.originalName).toLowerCase();
    if (!ALLOWED_EXTENSIONS.has(extension)) {
      throw new Error("JPG·PNG·WebP·GIF 이미지만 올릴 수 있습니다.");
    }
    // 확장자와 브라우저가 보낸 MIME은 업로더가 정하는 값이라 믿지 않습니다. 패드 업로드와 같은
    // 시그니처 검사를 통과해야 sharp까지 갑니다.
    const validated = await validateUploadedFile(uploaded, { maxBytes: perImageLimit });
    if (!validated.isImage) throw new Error("이미지 파일만 올릴 수 있습니다.");

    // 썸네일만 jpeg입니다. og:image로 나가는데 카카오톡 등 일부 링크 미리보기가 webp를
    // 렌더하지 못해서, 용량을 조금 손해 보더라도 호환성을 택합니다. 문항 이미지는 앱 안에서만
    // 쓰이므로 같은 화질에서 가장 작은 webp로 둡니다.
    const thumbnail = Boolean(options.thumbnail);
    const name = `${randomUUID()}.${thumbnail ? "jpg" : "webp"}`;
    const destination = getQuizImagePath(quizId, name);
    processingPath = `${destination}.uploading`;
    const edge = thumbnail ? MAX_QUIZ_THUMBNAIL_EDGE : MAX_QUIZ_IMAGE_EDGE;

    // limitInputPixels는 디코드 후 픽셀 수 상한입니다. 파일은 작은데 압축을 풀면 수억 픽셀이
    // 되는 이미지(압축 폭탄)가 메모리를 통째로 먹는 것을 막습니다. 패드 업로드와 같은 값입니다.
    const output = await withImageProcessingSlot(async () => {
      const pipeline = sharp(incomingPath!, { failOn: "error", limitInputPixels: 40_000_000 })
        .rotate()
        .resize({ width: edge, height: edge, fit: "inside", withoutEnlargement: true });
      // 투명 배경을 jpeg로 바꾸면 검게 깔립니다. 썸네일은 카드·링크 미리보기 배경이 흰색이라
      // 흰색으로 합성해야 원본과 같아 보입니다.
      return thumbnail
        ? pipeline.flatten({ background: "#ffffff" }).jpeg({ quality: 82, mozjpeg: true }).toFile(processingPath!)
        : pipeline.webp({ quality: 82, effort: 4 }).toFile(processingPath!);
    });

    await rename(/* turbopackIgnore: true */ processingPath, destination);
    processingPath = null;
    storedPath = destination;

    const storageLimit = await maxQuizImageStorageBytes();
    if (await quizImageStorageBytes(quizId) > storageLimit) {
      throw new QuizImageStorageLimitError(storageLimit);
    }
    await unlink(/* turbopackIgnore: true */ incomingPath);
    incomingPath = null;

    committed = true;
    return { url: quizImageUrl(quizId, name), width: output.width, height: output.height, bytes: output.size };
  } finally {
    if (incomingPath) await unlink(/* turbopackIgnore: true */ incomingPath).catch(() => undefined);
    if (processingPath) await unlink(/* turbopackIgnore: true */ processingPath).catch(() => undefined);
    if (!committed && storedPath) await unlink(/* turbopackIgnore: true */ storedPath).catch(() => undefined);
  }
}

async function quizImageStorageBytes(quizId: string) {
  let entries: string[];
  try {
    entries = await readdir(/* turbopackIgnore: true */ getQuizUploadDirectory(quizId));
  } catch (error) {
    if (isFileSystemError(error, "ENOENT")) return 0;
    throw error;
  }
  let bytes = 0;
  for (const entry of entries) {
    if (!isQuizImageName(entry)) continue;
    try {
      bytes += (await stat(/* turbopackIgnore: true */ getQuizImagePath(quizId, entry))).size;
    } catch (error) {
      if (!isFileSystemError(error, "ENOENT")) throw error;
    }
  }
  return bytes;
}

/** 편집 저장이 자기 퀴즈 디렉터리에 실제로 존재하는 올바른 종류의 이미지만 참조하게 합니다. */
export async function assertQuizImageReferences(
  quizId: string,
  references: { thumbnailUrl?: string | null; questionUrls?: (string | null | undefined)[] },
) {
  const local = [
    { url: references.thumbnailUrl, kind: "thumbnail" as const },
    ...(references.questionUrls ?? []).map((url) => ({ url, kind: "question" as const })),
  ];
  for (const { url, kind } of local) {
    const parsed = parseQuizImageUrl(url);
    if (!parsed) continue;
    if (parsed.quizId !== quizId) throw new Error("다른 퀴즈의 이미지는 참조할 수 없습니다.");
    if (kind === "thumbnail" && !parsed.name.endsWith(".jpg")) throw new Error("퀴즈 썸네일 형식이 올바르지 않습니다.");
    if (kind === "question" && !parsed.name.endsWith(".webp")) throw new Error("문항 이미지 형식이 올바르지 않습니다.");
    if (!await statQuizImage(quizId, parsed.name)) throw new Error("저장할 이미지를 찾을 수 없습니다. 다시 올려 주세요.");
  }
}

/**
 * 퀴즈를 복제할 때 참조된 이미지 파일도 복사하고, 새 주소로 바꾼 표를 돌려줍니다.
 *
 * 파일을 공유하지 않고 복사하는 이유: 원본 퀴즈를 지우면 사본의 이미지까지 함께 사라집니다.
 * 복제는 "가져다 내 것으로 고치는" 기능이라 원본의 수명에 묶이면 안 됩니다.
 */
export async function copyQuizImages(sourceQuizId: string, targetQuizId: string, sourceUrls: (string | null | undefined)[]) {
  const mapping = new Map<string, string>();
  const sources = [...new Set(sourceUrls.filter((url): url is string => parseQuizImageUrl(url)?.quizId === sourceQuizId))];
  if (!sources.length) return mapping;

  await mkdir(/* turbopackIgnore: true */ getQuizUploadDirectory(targetQuizId), { recursive: true });
  for (const url of sources) {
    const parsed = parseQuizImageUrl(url)!;
    const name = `${randomUUID()}${path.extname(parsed.name).toLowerCase()}`;
    try {
      await copyFile(
        /* turbopackIgnore: true */ getQuizImagePath(parsed.quizId, parsed.name),
        getQuizImagePath(targetQuizId, name),
      );
      mapping.set(url, quizImageUrl(targetQuizId, name));
    } catch (error) {
      // 원본 파일이 이미 없으면 이미지 없는 문항으로 복제합니다. 복제 전체를 실패시키는 것보다
      // 낫습니다 — 사용자는 편집기에서 사진만 다시 올리면 됩니다.
      if (!isFileSystemError(error, "ENOENT")) throw error;
    }
  }
  return mapping;
}

/** 퀴즈 이미지 디렉터리를 통째로 지웁니다(영구 삭제 경로 전용). */
export async function removeQuizImages(quizId: string) {
  await rm(/* turbopackIgnore: true */ getQuizUploadDirectory(quizId), { recursive: true, force: true });
}

/** 서빙 라우트가 쓰는 파일 정보. 없으면 null입니다. */
export async function statQuizImage(quizId: string, name: string) {
  try {
    const filePath = getQuizImagePath(quizId, name);
    const info = await stat(/* turbopackIgnore: true */ filePath);
    return info.isFile() ? { filePath, size: info.size, mtimeMs: info.mtimeMs } : null;
  } catch {
    return null;
  }
}
