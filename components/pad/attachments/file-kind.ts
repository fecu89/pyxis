"use client";

import type { AttachmentData } from "@/components/pad/types";

/**
 * 첨부가 "무슨 파일인지" 한곳에서 정합니다.
 *
 * `Attachment.type`(IMAGE·PDF·DOCUMENT·FILE…)만으로는 부족합니다. 한글·워드·PPT·엑셀·ZIP이
 * 전부 DOCUMENT 아니면 FILE로 뭉뚱그려지기 때문입니다. 카드에 "1개 첨부"라고만 뜨던 것도,
 * 한글 문서에 뷰어를 붙이지 못하던 것도 같은 이유입니다. 그래서 MIME과 확장자를 함께 보고
 * 사람이 읽는 이름과 뷰어 종류를 여기서 결정합니다.
 */

export type FileKind =
  | "IMAGE" | "VIDEO" | "AUDIO" | "LINK"
  | "PDF" | "HWP" | "WORD" | "SLIDES" | "SHEET" | "TEXT" | "ARCHIVE" | "FILE";

const EXTENSION_KINDS: Record<string, FileKind> = {
  pdf: "PDF",
  hwp: "HWP", hwpx: "HWP",
  doc: "WORD", docx: "WORD",
  ppt: "SLIDES", pptx: "SLIDES",
  xls: "SHEET", xlsx: "SHEET", csv: "SHEET",
  txt: "TEXT",
  zip: "ARCHIVE",
};

const MIME_KINDS: Record<string, FileKind> = {
  "application/pdf": "PDF",
  "application/x-hwp": "HWP",
  "application/haansofthwpx": "HWP",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document": "WORD",
  "application/vnd.openxmlformats-officedocument.presentationml.presentation": "SLIDES",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": "SHEET",
  "text/plain": "TEXT",
  "application/zip": "ARCHIVE",
  "application/x-zip-compressed": "ARCHIVE",
};

const KIND_LABELS: Record<FileKind, string> = {
  IMAGE: "사진",
  VIDEO: "영상",
  AUDIO: "음성",
  LINK: "링크",
  PDF: "PDF",
  HWP: "한글",
  WORD: "워드",
  SLIDES: "PPT",
  SHEET: "엑셀",
  TEXT: "텍스트",
  ARCHIVE: "압축",
  FILE: "파일",
};

type KindSource = Pick<AttachmentData, "type" | "mimeType" | "originalName">;

export function fileKindOf(attachment: KindSource): FileKind {
  // 미디어·링크는 Attachment.type만으로 확실합니다.
  if (attachment.type === "IMAGE" || attachment.type === "VIDEO" || attachment.type === "AUDIO" || attachment.type === "LINK") {
    return attachment.type;
  }
  // **확장자를 먼저** 봅니다. hwpx·docx·pptx·xlsx는 모두 zip 컨테이너라, 시그니처만 보는
  // 감지기가 hwpx를 그냥 application/zip으로 판정합니다. 실제로 그래서 한글 문서가 "압축"으로
  // 표시되고 뷰어도 붙지 않았습니다. 확장자가 이 형식들에서는 더 구체적인 신호입니다.
  const extension = attachment.originalName.split(".").pop()?.toLowerCase() ?? "";
  if (EXTENSION_KINDS[extension]) return EXTENSION_KINDS[extension];
  const mime = attachment.mimeType?.toLowerCase() ?? "";
  if (MIME_KINDS[mime]) return MIME_KINDS[mime];
  return attachment.type === "PDF" ? "PDF" : "FILE";
}

export function fileKindLabel(attachment: KindSource) {
  return KIND_LABELS[fileKindOf(attachment)];
}

/**
 * 카드 한 줄에 넣을 요약. "1개 첨부"만으로는 열어 보기 전엔 무슨 파일인지 알 수 없었습니다.
 * 종류가 여럿이면 중복을 빼고 이어 붙이고, 개수는 둘 이상일 때만 덧붙입니다.
 */
export function attachmentSummary(attachments: KindSource[]) {
  const labels: string[] = [];
  for (const attachment of attachments) {
    const label = fileKindLabel(attachment);
    if (!labels.includes(label)) labels.push(label);
  }
  const shown = labels.slice(0, 3);
  const rest = labels.length - shown.length;
  const kinds = rest > 0 ? `${shown.join(" · ")} +${rest}` : shown.join(" · ");
  return attachments.length > 1 ? `${kinds} (${attachments.length})` : kinds;
}
