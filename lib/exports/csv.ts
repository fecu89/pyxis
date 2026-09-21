import type { BoardExportData } from "@/lib/exports/data";

// 게시물 제목·본문·댓글은 전부 사용자 입력이라, 값이 "="/"+"/"-"/"@"나 탭·캐리지리턴으로
// 시작하면 엑셀·구글시트가 이걸 수식으로 해석해 실행합니다(CSV 인젝션). 이 내보내기의 대상은
// 보드 관리자라 공격 대상이 정확히 권한자여서, 셀 맨 앞에 작은따옴표를 붙여 문자열로 강제
// 고정합니다(OWASP 권장 완화 방법).
const FORMULA_TRIGGER_CHARS = new Set(["=", "+", "-", "@", "\t", "\r"]);

function csvCell(value: unknown): string {
  let text = value === null || value === undefined ? "" : String(value);
  if (text.length > 0 && FORMULA_TRIGGER_CHARS.has(text[0])) text = `'${text}`;
  return /[",\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

function toCsv(headers: string[], rows: unknown[][]): string {
  const lines = [headers, ...rows].map((row) => row.map(csvCell).join(","));
  // 엑셀(특히 Windows)에서 BOM 없는 UTF-8 CSV를 열면 한글이 깨지므로 BOM을 붙입니다.
  return `﻿${lines.join("\r\n")}`;
}

const STATUS_LABEL: Record<string, string> = { PENDING: "승인 대기", PUBLISHED: "게시됨", REJECTED: "거절됨" };

export function buildPostsCsv(data: BoardExportData): string {
  const customFieldLabels = [...new Set(data.posts.flatMap((post) => post.customFields.map((field) => field.label)))];
  const headers = ["섹션", "제목", "본문", "작성자", "상태", "거절 사유", "고정 여부", "댓글 수", "반응 수", "작성일", ...customFieldLabels];
  const rows = data.posts.map((post) => {
    const fieldByLabel = new Map(post.customFields.map((field) => [field.label, field.value]));
    const totalReactions = Object.values(post.reactionCounts).reduce((sum, count) => sum + count, 0);
    return [
      post.sectionTitle ?? "",
      post.title ?? "",
      post.body,
      post.author.name ?? "이름 없음",
      STATUS_LABEL[post.status] ?? post.status,
      post.moderationReason ?? "",
      post.isPinned ? "Y" : "N",
      post.commentCount,
      totalReactions,
      post.createdAt.toISOString(),
      ...customFieldLabels.map((label) => fieldByLabel.get(label) ?? ""),
    ];
  });
  return toCsv(headers, rows);
}

export function buildCommentsCsv(data: BoardExportData): string {
  const headers = ["게시물 제목", "작성자", "본문", "답글 대상 댓글 ID", "작성일"];
  const rows = data.posts.flatMap((post) => post.comments.map((comment) => [
    post.title ?? "(제목 없음)",
    comment.authorName ?? "이름 없음",
    comment.body,
    comment.parentId ?? "",
    comment.createdAt.toISOString(),
  ]));
  return toCsv(headers, rows);
}

export function buildReactionsCsv(data: BoardExportData): string {
  const headers = ["게시물 제목", "반응 종류", "개수"];
  const rows = data.posts.flatMap((post) => Object.entries(post.reactionCounts).map(([key, count]) => [post.title ?? "(제목 없음)", key, count]));
  return toCsv(headers, rows);
}
