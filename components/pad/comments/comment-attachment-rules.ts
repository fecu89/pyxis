import { fileKey } from "@/components/pad/attachments/file-rules";
import { cachedUploadPolicy } from "@/lib/files/upload-policy-client";
import { mb } from "@/lib/files/upload-policy-shape";

export const maximumCommentAttachmentCount = 4;
export const commentAttachmentAccept = ".jpg,.jpeg,.png,.webp,.gif,.mp3,.m4a,.wav,.ogg,.webm,.pdf";
export const guestCommentAttachmentAccept = ".jpg,.jpeg,.png,.webp,.gif";

type CommentAttachmentKind = "IMAGE" | "AUDIO" | "PDF";

const imageTypes = new Set(["image/jpeg", "image/png", "image/webp", "image/gif"]);
const audioTypes = new Set(["audio/mpeg", "audio/mp4", "audio/x-m4a", "audio/wav", "audio/x-wav", "audio/ogg", "audio/webm"]);
const imageExtensions = new Set(["jpg", "jpeg", "png", "webp", "gif"]);
const audioExtensions = new Set(["mp3", "m4a", "wav", "ogg", "webm"]);

function extension(file: File) {
  return file.name.split(".").pop()?.toLowerCase() ?? "";
}

export function commentAttachmentKind(file: File): CommentAttachmentKind | null {
  const mime = file.type.toLowerCase().split(";", 1)[0];
  const ext = extension(file);
  if (imageTypes.has(mime) || imageExtensions.has(ext)) return "IMAGE";
  if (audioTypes.has(mime) || audioExtensions.has(ext)) return "AUDIO";
  if (mime === "application/pdf" || ext === "pdf") return "PDF";
  return null;
}

export function prepareCommentAttachmentFiles(
  incoming: File[],
  existing: File[] = [],
  guestOnly = false,
) {
  const policy = cachedUploadPolicy();
  const accepted: File[] = [];
  const rejected: string[] = [];
  const known = new Set(existing.map(fileKey));
  let count = existing.length;

  for (const file of incoming) {
    if (count >= maximumCommentAttachmentCount) {
      rejected.push(`댓글에는 첨부를 ${maximumCommentAttachmentCount}개까지만 추가할 수 있습니다.`);
      break;
    }
    const kind = commentAttachmentKind(file);
    if (!kind) {
      rejected.push(`${file.name || "파일"}: 이미지, 음성 또는 PDF만 첨부할 수 있습니다.`);
      continue;
    }
    if (guestOnly && kind !== "IMAGE") {
      rejected.push(`${file.name || "파일"}: 로그인 없이 댓글을 쓸 때는 이미지만 첨부할 수 있습니다.`);
      continue;
    }
    const maximumBytes = mb(kind === "IMAGE"
      ? Math.min(policy.maxImageUploadMb, policy.maxUploadMb)
      : policy.maxUploadMb);
    if (file.size <= 0 || file.size > maximumBytes) {
      rejected.push(`${file.name || "파일"}: ${Math.floor(maximumBytes / 1024 / 1024)}MB 이하 파일만 첨부할 수 있습니다.`);
      continue;
    }
    const key = fileKey(file);
    if (known.has(key)) continue;
    known.add(key);
    accepted.push(file);
    count += 1;
  }

  return { accepted, rejected };
}
