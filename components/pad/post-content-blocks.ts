import type { AttachmentViewData } from "@/components/pad/attachments/types";

export type PendingAttachmentReference = {
  kind: "upload" | "link";
  id: string;
};

export type PostContentSegment =
  | { kind: "markdown"; body: string }
  | { kind: "attachment"; attachmentId: string };

// 첨부 블록은 단독 문단인 Markdown 링크로 저장합니다. 편집기 안에서는 파일명이 보이고,
// 게시물 표시에서는 이 줄을 실제 첨부로 교체합니다. 현재 게시물의 첨부 ID만 해석하므로 다른
// 게시물 파일을 가리키는 문자열을 직접 써도 권한이나 표시 범위를 우회할 수 없습니다.
// Milkdown은 알 수 없는 URL 프로토콜을 보안상 빈 href로 바꿉니다. 새 표식은 안전한 상대
// 경로(`/` 구분)를 쓰고, 이미 저장됐을 수 있는 이전 `:` 표식도 계속 읽습니다.
const attachmentBlockPattern = /^[\t ]*\[(?:\\.|[^\]\r\n]){1,400}\]\(<?pyxis-attachment(?::|\/)([A-Za-z0-9_-]{1,128})>?\)[\t ]*(?:\r?\n|$)/gm;
const pendingBlockPattern = /^[\t ]*\[(?:\\.|[^\]\r\n]){1,400}\]\(<?pyxis-(upload|link)(?::|\/)([A-Za-z0-9_-]{1,128})>?\)[\t ]*(?:\r?\n|$)/gm;
const pendingUrlPattern = /pyxis-(upload|link)(?::|\/)([A-Za-z0-9_-]{1,128})/g;

function escapeMarkdownLabel(value: string) {
  return value
    .replace(/[\r\n]+/g, " ")
    .replace(/\\/g, "\\\\")
    .replace(/([\[\]])/g, "\\$1")
    .trim()
    .slice(0, 260);
}

function attachmentLabel(type: AttachmentViewData["type"] | "PENDING", name: string) {
  const prefix = type === "IMAGE" ? "이미지" : type === "LINK" ? "링크" : "첨부";
  return `${prefix} · ${escapeMarkdownLabel(name) || "이름 없는 파일"}`;
}

export function storedAttachmentBlock(attachment: Pick<AttachmentViewData, "id" | "type" | "originalName">) {
  return `[${attachmentLabel(attachment.type, attachment.originalName)}](pyxis-attachment/${attachment.id})`;
}

export function pendingAttachmentBlock(reference: PendingAttachmentReference, name: string, type: AttachmentViewData["type"] | "PENDING" = "PENDING") {
  return `[${attachmentLabel(type, name)}](pyxis-${reference.kind}/${reference.id})`;
}

export function replacePendingAttachmentReferences(
  body: string,
  replacements: ReadonlyMap<string, string>,
) {
  return body.replace(pendingUrlPattern, (value, kind: string, id: string) => {
    const attachmentId = replacements.get(`${kind}:${id}`);
    return attachmentId ? `pyxis-attachment/${attachmentId}` : value;
  });
}

/** 아직 업로드되지 못한 임시 블록은 공개 본문에 파일명 링크로 남기지 않습니다. */
export function stripPendingAttachmentBlocks(body: string) {
  return body.replace(pendingBlockPattern, "").replace(/\n{3,}/g, "\n\n").trim();
}

function removeMarkerLines(body: string, markers: string[]) {
  return body
    .split(/\r?\n/)
    .filter((line) => !markers.some((marker) => line.includes(marker)))
    .join("\n")
    .replace(/\n{3,}/g, "\n\n");
}

export function removeAttachmentBlock(body: string, reference: PendingAttachmentReference) {
  const markers = [`pyxis-${reference.kind}/${reference.id}`, `pyxis-${reference.kind}:${reference.id}`];
  return removeMarkerLines(body, markers);
}

/** 서버에서 삭제한 첨부가 본문 안에 빈 자리로 남지 않게 새·이전 표식을 함께 지웁니다. */
export function removeStoredAttachmentBlock(body: string, attachmentId: string) {
  return removeMarkerLines(body, [`pyxis-attachment/${attachmentId}`, `pyxis-attachment:${attachmentId}`]);
}

export function hasAttachmentReference(body: string, kind: "attachment" | "upload" | "link", id: string) {
  return body.includes(`pyxis-${kind}/${id}`) || body.includes(`pyxis-${kind}:${id}`);
}

export function referencedAttachmentIds(body: string) {
  const ids = new Set<string>();
  for (const match of body.matchAll(attachmentBlockPattern)) ids.add(match[1]);
  return ids;
}

export function postContentSegments(body: string, attachments: AttachmentViewData[]): PostContentSegment[] {
  // 생성 직후 파일을 올리는 짧은 동안에도 임시 파일명 링크가 다른 사용자에게 보이지 않게 합니다.
  const visibleBody = stripPendingAttachmentBlocks(body);
  const available = new Set(attachments.map((attachment) => attachment.id));
  const segments: PostContentSegment[] = [];
  let cursor = 0;
  for (const match of visibleBody.matchAll(attachmentBlockPattern)) {
    const index = match.index ?? 0;
    const markdown = visibleBody.slice(cursor, index);
    if (markdown.trim()) segments.push({ kind: "markdown", body: markdown });
    if (available.has(match[1])) segments.push({ kind: "attachment", attachmentId: match[1] });
    cursor = index + match[0].length;
  }
  const tail = visibleBody.slice(cursor);
  if (tail.trim()) segments.push({ kind: "markdown", body: tail });
  return segments;
}
