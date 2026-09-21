"use client";

// 검증 "방식"은 댓글 첨부(comment-attachment-input.tsx)처럼 확장자 추정이 아니라 실제
// MIME 타입으로 판정합니다. 다만 게시물은 서버가 이미지·비디오·오디오·PDF·문서·zip·hwp 등
// 폭넓은 형식과 개당 20개까지 허용하므로(app/api/posts/[postId]/attachments/route.ts,
// lib/files/validation.ts), 댓글의 "이미지·음성 4개"로 범위를 좁히지 않고 게시물이 실제
// 지원하는 형식·개수는 그대로 유지한 채 타입별 용량 상한만 둡니다.
//
// hwp/hwpx나 일부 오피스 문서는 브라우저가 file.type을 비워서 주는 경우가 흔해, MIME이
// 비어 있거나 알려진 형식과 매치되지 않으면 확장자로 한 번 더 확인합니다(서버는 어차피
// 실제 파일 시그니처로 다시 검증하므로, 클라이언트 검사는 사용자 실수를 빨리 알려주는
// 역할이면 충분합니다).
export type AttachmentFileCategory = "IMAGE" | "VIDEO" | "AUDIO" | "PDF" | "DOCUMENT" | "ARCHIVE" | "HWP";

const mimeTypesByCategory: Record<AttachmentFileCategory, Set<string>> = {
  IMAGE: new Set(["image/jpeg", "image/png", "image/webp", "image/gif"]),
  VIDEO: new Set(["video/mp4", "video/webm", "video/quicktime"]),
  AUDIO: new Set(["audio/mpeg", "audio/mp4", "audio/x-m4a", "audio/wav", "audio/x-wav", "audio/ogg", "audio/webm"]),
  PDF: new Set(["application/pdf"]),
  DOCUMENT: new Set([
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    "application/vnd.openxmlformats-officedocument.presentationml.presentation",
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    "text/plain",
  ]),
  ARCHIVE: new Set(["application/zip", "application/x-zip-compressed"]),
  HWP: new Set([]), // 브라우저가 신뢰할 만한 MIME을 안 줘서 항상 확장자로만 판정합니다.
};

import { cachedUploadPolicy } from "@/lib/files/upload-policy-client";
import { mb, type UploadPolicy } from "@/lib/files/upload-policy-shape";

const extensionsByCategory: Record<AttachmentFileCategory, Set<string>> = {
  IMAGE: new Set(["jpg", "jpeg", "png", "webp", "gif"]),
  VIDEO: new Set(["mp4", "webm", "mov"]),
  AUDIO: new Set(["mp3", "m4a", "wav", "ogg"]),
  PDF: new Set(["pdf"]),
  DOCUMENT: new Set(["docx", "pptx", "xlsx", "txt"]),
  ARCHIVE: new Set(["zip"]),
  HWP: new Set(["hwp", "hwpx"]),
};

// 형식별 상한은 관리 페이지 → 정책 탭의 값에서 파생합니다. 예전에는 여기 숫자가 직접 박혀
// 있어서, 정책을 바꿔도 파일 선택창은 옛 값으로 안내하고 서버만 다른 판정을 했습니다.
//
// 이미지는 서버가 다시 인코딩하므로 따로 좁은 상한을 두고, 나머지는 전체 첨부 상한을 씁니다.
// (예전에는 음성만 20MB라는 중간값이 있었는데, 관리자가 조정할 축이 "이미지"와 "파일" 둘이라
//  음성도 파일 상한을 따르게 합니다.)
function capBytesFor(category: AttachmentFileCategory, policy: UploadPolicy) {
  const limitMb = category === "IMAGE"
    ? Math.min(policy.maxImageUploadMb, policy.maxUploadMb)
    : policy.maxUploadMb;
  return mb(limitMb);
}

const pastedImageExtensions: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "image/gif": "gif",
};

export const attachmentAccept = [
  ".jpg", ".jpeg", ".png", ".webp", ".gif",
  ".pdf", ".docx", ".pptx", ".xlsx", ".txt", ".zip", ".hwp", ".hwpx",
  ".mp4", ".webm", ".mov",
  ".mp3", ".m4a", ".wav", ".ogg",
].join(",");

// 손님(비로그인)은 이미지만 올릴 수 있습니다. 서버가 같은 제한을 다시 겁니다
// (app/api/posts/[postId]/attachments/route.ts) — 여기서 좁히는 건 파일 선택창에서
// 고를 수 없게 해 헛수고를 줄이려는 것입니다.
export const guestAttachmentAccept = [".jpg", ".jpeg", ".png", ".webp", ".gif"].join(",");

// 게시물 첨부 개당 최대 20개(app/api/posts/[postId]/attachments/route.ts와 동일).
export const maximumAttachmentCount = 20;
// 손님은 5개까지. 서버도 같은 값을 씁니다.
export const guestMaximumAttachmentCount = 5;

/** 손님이 고른 파일 중 이미지가 아닌 것을 걸러 냅니다. 서버 판정과 같은 기준입니다. */
export function rejectNonImages(files: File[]) {
  const accepted: File[] = [];
  const rejected: string[] = [];
  for (const file of files) {
    if (classifyAttachmentFile(file) === "IMAGE") accepted.push(file);
    else rejected.push(`${file.name || "파일"}: 로그인 없이 올릴 때는 사진만 첨부할 수 있어요.`);
  }
  return { accepted, rejected };
}

function extension(file: Pick<File, "name">) {
  return file.name.split(".").pop()?.toLowerCase() ?? "";
}

export function fileKey(file: File) {
  return `${file.name}:${file.size}:${file.lastModified}:${file.type}`;
}

/**
 * 일부 앱은 텍스트를 복사할 때 렌더링된 WebP도 클립보드 파일로 함께 넣습니다. 텍스트가
 * 하나라도 있으면 입력을 우선하고, 스크린샷처럼 파일만 담긴 붙여넣기만 첨부로 처리합니다.
 */
export function attachmentFilesFromClipboard(
  clipboard: Pick<DataTransfer, "items" | "types">,
) {
  const hasText = Array.from(clipboard.types).some((type) => type === "text/plain" || type === "text/html");
  if (hasText) return [];
  return Array.from(clipboard.items)
    .filter((item) => item.kind === "file")
    .map((item) => item.getAsFile())
    .filter((file): file is File => file !== null);
}

export function classifyAttachmentFile(file: Pick<File, "name" | "type">): AttachmentFileCategory | null {
  // MediaRecorder는 `audio/webm;codecs=opus`처럼 파라미터를 붙입니다. 화면 분류에서는 기본
  // MIME만 비교하고, 실제 컨테이너·코덱 검사는 서버 시그니처 검증이 맡습니다.
  const mime = file.type.toLowerCase().split(";", 1)[0].trim();
  if (mime) {
    for (const category of Object.keys(mimeTypesByCategory) as AttachmentFileCategory[]) {
      if (mimeTypesByCategory[category].has(mime)) return category;
    }
  }
  const ext = extension(file);
  for (const category of Object.keys(extensionsByCategory) as AttachmentFileCategory[]) {
    if (extensionsByCategory[category].has(ext)) return category;
  }
  return null;
}

function normalizePastedFile(file: File, index: number) {
  if (classifyAttachmentFile(file)) return file;
  const normalizedExtension = pastedImageExtensions[file.type];
  if (!normalizedExtension) return file;
  return new File(
    [file],
    `붙여넣은_이미지_${new Date().toISOString().replaceAll(":", "-")}_${index + 1}.${normalizedExtension}`,
    { type: file.type, lastModified: file.lastModified || Date.now() },
  );
}

export function prepareAttachmentFiles(
  incoming: File[],
  existing: File[] = [],
  maximumCount = maximumAttachmentCount,
  // 정책을 아직 못 받았으면 기본값으로 안내합니다. 최종 판정은 어차피 서버가 합니다.
  policy: UploadPolicy = cachedUploadPolicy(),
  // 이미 서버에 저장된 파일과 추가 대기 링크는 File 객체가 없지만 같은 20개 한도를 씁니다.
  reservedCount = 0,
) {
  const accepted: File[] = [];
  const rejected: string[] = [];
  const known = new Set(existing.map(fileKey));
  let total = existing.length + reservedCount;
  incoming.map(normalizePastedFile).forEach((file) => {
    if (total >= maximumCount) {
      rejected.push(`게시물에는 첨부를 ${maximumCount}개까지만 추가할 수 있습니다.`);
      return;
    }
    if (file.size <= 0) {
      rejected.push(`${file.name || "파일"}: 빈 파일은 첨부할 수 없습니다.`);
      return;
    }
    const category = classifyAttachmentFile(file);
    if (!category) {
      rejected.push(`${file.name || "파일"}: 지원하지 않는 파일 형식입니다.`);
      return;
    }
    const maximumBytes = capBytesFor(category, policy);
    if (file.size > maximumBytes) {
      rejected.push(`${file.name}: ${Math.floor(maximumBytes / 1024 / 1024)}MB 이하 파일만 첨부할 수 있습니다.`);
      return;
    }
    const key = fileKey(file);
    if (known.has(key)) return;
    known.add(key);
    accepted.push(file);
    total += 1;
  });
  return { accepted, rejected };
}
