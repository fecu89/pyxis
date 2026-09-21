import ExcelJS from "exceljs";
import type { BoardExportData } from "@/lib/exports/data";
import { APP_NAME } from "@/lib/brand";

const STATUS_LABEL: Record<string, string> = { PENDING: "승인 대기", PUBLISHED: "게시됨", REJECTED: "거절됨" };

// 매 게시물마다 다른 사용자 정의 필드 집합을 쓸 수 있어, 시트 하나에서 쓰는 열 이름을
// 보드 전체 게시물에서 실제 등장한 라벨을 모아 고정합니다.
function customFieldLabels(data: BoardExportData) {
  return [...new Set(data.posts.flatMap((post) => post.customFields.map((field) => field.label)))];
}

export async function buildBoardWorkbook(data: BoardExportData): Promise<ExcelJS.Buffer> {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = APP_NAME;
  workbook.created = new Date();

  const fieldLabels = customFieldLabels(data);
  const postsSheet = workbook.addWorksheet("게시물");
  postsSheet.columns = [
    { header: "섹션", key: "section", width: 16 },
    { header: "제목", key: "title", width: 24 },
    { header: "본문", key: "body", width: 48 },
    { header: "작성자", key: "author", width: 14 },
    { header: "상태", key: "status", width: 10 },
    { header: "거절 사유", key: "moderationReason", width: 20 },
    { header: "고정 여부", key: "pinned", width: 10 },
    { header: "댓글 수", key: "commentCount", width: 8 },
    { header: "반응 수", key: "reactionCount", width: 8 },
    { header: "작성일", key: "createdAt", width: 20 },
    ...fieldLabels.map((label, index) => ({ header: label, key: `field_${index}`, width: 20 })),
  ];
  for (const post of data.posts) {
    const fieldByLabel = new Map(post.customFields.map((field) => [field.label, field.value]));
    const totalReactions = Object.values(post.reactionCounts).reduce((sum, count) => sum + count, 0);
    const row: Record<string, string | number> = {
      section: post.sectionTitle ?? "",
      title: post.title ?? "",
      body: post.body,
      author: post.author.name ?? "이름 없음",
      status: STATUS_LABEL[post.status] ?? post.status,
      moderationReason: post.moderationReason ?? "",
      pinned: post.isPinned ? "Y" : "N",
      commentCount: post.commentCount,
      reactionCount: totalReactions,
      createdAt: post.createdAt.toISOString(),
    };
    fieldLabels.forEach((label, index) => { row[`field_${index}`] = fieldByLabel.get(label) ?? ""; });
    postsSheet.addRow(row);
  }

  const commentsSheet = workbook.addWorksheet("댓글");
  commentsSheet.columns = [
    { header: "게시물 제목", key: "postTitle", width: 24 },
    { header: "작성자", key: "author", width: 14 },
    { header: "본문", key: "body", width: 48 },
    { header: "답글 대상 댓글 ID", key: "parentId", width: 20 },
    { header: "작성일", key: "createdAt", width: 20 },
  ];
  for (const post of data.posts) {
    for (const comment of post.comments) {
      commentsSheet.addRow({
        postTitle: post.title ?? "(제목 없음)",
        author: comment.authorName ?? "이름 없음",
        body: comment.body,
        parentId: comment.parentId ?? "",
        createdAt: comment.createdAt.toISOString(),
      });
    }
  }

  const reactionsSheet = workbook.addWorksheet("반응");
  reactionsSheet.columns = [
    { header: "게시물 제목", key: "postTitle", width: 24 },
    { header: "반응 종류", key: "key", width: 14 },
    { header: "개수", key: "count", width: 8 },
  ];
  for (const post of data.posts) {
    for (const [key, count] of Object.entries(post.reactionCounts)) {
      reactionsSheet.addRow({ postTitle: post.title ?? "(제목 없음)", key, count });
    }
  }

  return workbook.xlsx.writeBuffer();
}
