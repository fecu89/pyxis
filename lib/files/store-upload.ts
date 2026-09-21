import "server-only";

import { mkdir, rename, stat, unlink } from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";
import type { AttachmentType } from "@/generated/prisma/client";
import { createStoredFilename, normalizeOriginalFilename } from "@/lib/files/filename";
import { type StreamedUpload, streamMultipartFile } from "@/lib/files/multipart";
import { toStoragePath } from "@/lib/files/paths";
import { withImageProcessingSlot } from "@/lib/files/processing-queue";
import { maxUploadBytes, validateUploadedFile } from "@/lib/files/validation";

/** 실패 로그에 남길 업로더와 대상. 거절된 업로드는 DB에 아무 흔적도 남지 않으므로 여기서만 알 수 있습니다. */
export type UploadContext = {
  /** 어느 업로드 경로인지(예: "댓글 첨부"). */
  target: string;
  userId?: string | null;
  guestId?: string | null;
  boardId?: string;
  postId?: string;
  commentId?: string;
};

// 파일 이름과 Content-Type은 업로더가 정하는 값이라 개행·제어문자를 섞어 로그 줄을 위조할 수
// 있습니다. 한 줄로 눌러 담고 길이도 잘라서 남깁니다.
function sanitizeForLog(value: string, maxLength: number) {
  const cleaned = value.replace(/\p{C}/gu, " ").replace(/\s+/g, " ").trim();
  if (!cleaned) return "(없음)";
  return cleaned.length > maxLength ? `${cleaned.slice(0, maxLength)}…` : cleaned;
}

function logUploadFailure(context: UploadContext, uploaded: StreamedUpload | null, error: unknown) {
  const actor = context.userId ? `user:${context.userId}` : context.guestId ? `guest:${context.guestId}` : "익명";
  const place = [
    context.boardId && `board:${context.boardId}`,
    context.postId && `post:${context.postId}`,
    context.commentId && `comment:${context.commentId}`,
  ].filter(Boolean).join(" ");
  const file = uploaded
    ? `파일="${sanitizeForLog(uploaded.originalName, 120)}" 형식=${sanitizeForLog(uploaded.mimeType, 80)} 크기=${uploaded.size}B`
    : "파일=(수신 전)";
  const reason = error instanceof Error ? sanitizeForLog(error.message, 200) : "알 수 없는 오류";
  console.warn(`[첨부 업로드 실패] ${context.target} ${actor} ${place} ${file} 사유=${reason}`);
}

export async function storeAttachmentUpload(
  request: Request,
  directory: string,
  options: { allowedTypes?: AttachmentType[]; maxBytes?: number; context?: UploadContext } = {},
) {
  let uploadedFile: StreamedUpload | null = null;
  let incomingPath: string | null = null;
  let processingPath: string | null = null;
  let completedPath: string | null = null;
  let thumbnailProcessingPath: string | null = null;
  let thumbnailPath: string | null = null;
  try {
    const limit = Math.min(await maxUploadBytes(), options.maxBytes ?? Number.POSITIVE_INFINITY);
    const uploaded = await streamMultipartFile(request, directory, limit);
    uploadedFile = uploaded;
    incomingPath = uploaded.temporaryPath;
    const validated = await validateUploadedFile(uploaded, { maxBytes: limit });
    if (options.allowedTypes && !options.allowedTypes.includes(validated.attachmentType)) {
      throw new Error("이 위치에 첨부할 수 없는 파일 형식입니다.");
    }
    const { baseName, storedName } = createStoredFilename(validated.extension);
    const originalName = normalizeOriginalFilename(uploaded.originalName, validated.extension);
    completedPath = path.join(/* turbopackIgnore: true */ directory, storedName);
    let width: number | null = null;
    let height: number | null = null;

    if (validated.isImage) {
      processingPath = `${completedPath}.uploading`;
      const thumbnailDirectory = path.join(/* turbopackIgnore: true */ directory, "thumbnails");
      await mkdir(/* turbopackIgnore: true */ thumbnailDirectory, { recursive: true });
      thumbnailPath = path.join(/* turbopackIgnore: true */ thumbnailDirectory, `${baseName}.webp`);
      thumbnailProcessingPath = `${thumbnailPath}.uploading`;
      const output = await withImageProcessingSlot(async () => {
        const converted = await sharp(incomingPath!, { failOn: "error", limitInputPixels: 40_000_000 })
          .rotate()
          .resize({ width: 2560, height: 2560, fit: "inside", withoutEnlargement: true })
          .webp({ quality: 82, effort: 4 })
          .toFile(processingPath!);
        await sharp(processingPath!, { failOn: "error" })
          .resize({ width: 960, height: 960, fit: "inside", withoutEnlargement: true })
          .webp({ quality: 76, effort: 3 })
          .toFile(thumbnailProcessingPath!);
        return converted;
      });
      width = output.width;
      height = output.height;
      await rename(/* turbopackIgnore: true */ processingPath, completedPath);
      processingPath = null;
      await rename(/* turbopackIgnore: true */ thumbnailProcessingPath, thumbnailPath);
      thumbnailProcessingPath = null;
      await unlink(/* turbopackIgnore: true */ incomingPath);
      incomingPath = null;
    } else {
      await rename(/* turbopackIgnore: true */ incomingPath, completedPath);
      incomingPath = null;
    }

    const fileInfo = await stat(/* turbopackIgnore: true */ completedPath);
    const storedPath = completedPath;
    const storedThumbnailPath = thumbnailPath;
    completedPath = null;
    thumbnailPath = null;
    return {
      data: {
        type: validated.attachmentType,
        originalName,
        storedName,
        storagePath: toStoragePath(storedPath),
        thumbnailPath: storedThumbnailPath ? toStoragePath(storedThumbnailPath) : null,
        mimeType: validated.mimeType,
        fileSize: fileInfo.size,
        width,
        height,
      },
      async cleanup() {
        await unlink(/* turbopackIgnore: true */ storedPath).catch(() => undefined);
        if (storedThumbnailPath) await unlink(/* turbopackIgnore: true */ storedThumbnailPath).catch(() => undefined);
      },
    };
  } catch (error) {
    if (options.context) logUploadFailure(options.context, uploadedFile, error);
    if (incomingPath) await unlink(/* turbopackIgnore: true */ incomingPath).catch(() => undefined);
    if (processingPath) await unlink(/* turbopackIgnore: true */ processingPath).catch(() => undefined);
    if (completedPath) await unlink(/* turbopackIgnore: true */ completedPath).catch(() => undefined);
    if (thumbnailProcessingPath) await unlink(/* turbopackIgnore: true */ thumbnailProcessingPath).catch(() => undefined);
    if (thumbnailPath) await unlink(/* turbopackIgnore: true */ thumbnailPath).catch(() => undefined);
    throw error;
  }
}
