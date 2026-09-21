import "server-only";
import { toCommentAuthorDTO, toPostAuthorDTO } from "@/lib/board/post-author";

import { getPrisma } from "@/lib/prisma";
import { parsePostFieldConfig } from "@/lib/post-fields/validation";
import { defaultPostFieldConfig } from "@/lib/post-fields/defaults";
import type { CustomPostFieldDefinition } from "@/lib/post-fields/types";

// CSV(type별)·XLSX·발표 모드가 실제로 쓰는 관계가 서로 달라서, 호출부가 댓글 "본문·작성자"까지
// 필요한지 고를 수 있습니다. 예전에는 CSV type=posts(댓글 "개수"만 표에 씀)조차 매번 모든
// 댓글의 본문과 작성자를 복호화해서 가져왔습니다 — 댓글은 유일하게 작성자 PII 복호화 비용이
// 있는 관계라 이것만 선택적으로 켭니다. attachments·reactions는 복호화가 없는 가벼운 관계라
// 항상 함께 가져오고, 댓글 개수는 관계를 안 켜도 가벼운 집계(_count)로 항상 채워집니다.
const baseSelect = {
  id: true,
  title: true,
  body: true,
  status: true,
  moderationReason: true,
  customFieldValues: true,
  isPinned: true,
  createdAt: true,
  updatedAt: true,
  sectionId: true,
  section: { select: { id: true, title: true } },
  author: { select: { id: true, nameEncrypted: true, imageEncrypted: true } },
  // 손님 글은 author가 null이라 표시 이름을 함께 읽습니다.
  guestName: true,
  attachments: {
    where: { deletedAt: null, commentId: null },
    orderBy: { sortOrder: "asc" as const },
    select: { id: true, type: true, originalName: true, storagePath: true, externalUrl: true, previewImageUrl: true, mimeType: true, fileSize: true },
  },
  reactions: { select: { key: true } },
  _count: { select: { comments: { where: { deletedAt: null } } } },
} as const;

const commentsSelect = {
  where: { deletedAt: null },
  orderBy: { createdAt: "asc" as const },
  select: {
    id: true,
    body: true,
    parentId: true,
    createdAt: true,
    author: { select: { id: true, nameEncrypted: true, imageEncrypted: true } },
    // 손님 댓글은 author가 null이라 표시 이름을 함께 읽습니다.
    guestName: true,
  },
} as const;

export type BoardExportPost = {
  id: string;
  sectionTitle: string | null;
  title: string | null;
  body: string;
  status: "PENDING" | "PUBLISHED" | "REJECTED";
  moderationReason: string | null;
  author: { id: string; name: string | null; image: string | null };
  isPinned: boolean;
  createdAt: Date;
  updatedAt: Date;
  customFields: { label: string; value: string }[];
  // commentCount는 relations에 "comments"를 안 넣어도 항상 채워집니다(가벼운 집계 쿼리).
  // comments 배열 자체(본문·작성자 포함)는 relations에 "comments"를 넣었을 때만 채워집니다.
  commentCount: number;
  attachments: { id: string; type: string; originalName: string; storagePath: string | null; externalUrl: string | null; previewImageUrl: string | null; mimeType: string; fileSize: number }[];
  comments: { id: string; authorName: string | null; body: string; parentId: string | null; createdAt: Date }[];
  reactionCounts: Record<string, number>;
};

export type BoardExportData = {
  boardTitle: string;
  posts: BoardExportPost[];
};

function flattenCustomFields(customFieldValues: unknown, customFieldDefinitions: CustomPostFieldDefinition[]) {
  if (!customFieldValues || typeof customFieldValues !== "object") return [];
  const stored = customFieldValues as { fields?: Record<string, { value: string | string[] }> };
  if (!stored.fields) return [];
  const labelById = new Map(customFieldDefinitions.map((field) => [field.id, field.label]));
  return Object.entries(stored.fields).map(([fieldId, entry]) => ({
    label: labelById.get(fieldId) ?? fieldId,
    value: Array.isArray(entry.value) ? entry.value.join(", ") : entry.value,
  }));
}

// CSV·XLSX·발표 모드가 공통으로 쓰는 원본 데이터 조회입니다. 관리자용 대량 내보내기는
// statusFilter를 생략해 PENDING·REJECTED까지 모두 담고, 발표 모드는 "PUBLISHED"만 넘겨
// 일반 독자가 보드에서 이미 볼 수 있는 범위로 제한합니다. includeComments가 false면(댓글
// 본문·작성자가 필요 없는 호출부) 댓글 관계를 아예 조인하지 않습니다.
export async function gatherBoardExportData(
  boardId: string,
  statusFilter?: "PUBLISHED",
  includeComments = true,
): Promise<BoardExportData> {
  const prisma = getPrisma();
  const board = await prisma.board.findUnique({ where: { id: boardId }, select: { title: true, postFieldConfig: true } });
  if (!board) throw new Error("패드를 찾을 수 없습니다.");
  const fieldConfig = parsePostFieldConfig(board.postFieldConfig ?? defaultPostFieldConfig);

  const where = { boardId, deletedAt: null, ...(statusFilter ? { status: statusFilter } : {}) };
  const orderBy = [{ section: { position: "asc" as const } }, { isPinned: "desc" as const }, { position: "asc" as const }, { id: "asc" as const }];

  const posts = includeComments
    ? await prisma.post.findMany({ where, orderBy, select: { ...baseSelect, comments: commentsSelect } })
    : await prisma.post.findMany({ where, orderBy, select: baseSelect });

  return {
    boardTitle: board.title,
    posts: posts.map((post) => ({
      id: post.id,
      sectionTitle: post.section?.title ?? null,
      title: post.title,
      body: post.body,
      status: post.status,
      moderationReason: post.moderationReason,
      author: toPostAuthorDTO(post),
      isPinned: post.isPinned,
      createdAt: post.createdAt,
      updatedAt: post.updatedAt,
      customFields: flattenCustomFields(post.customFieldValues, fieldConfig.customFields),
      commentCount: post._count.comments,
      attachments: post.attachments.map((attachment) => ({
        id: attachment.id,
        type: attachment.type,
        originalName: attachment.originalName,
        storagePath: attachment.storagePath,
        externalUrl: attachment.externalUrl,
        previewImageUrl: attachment.previewImageUrl,
        mimeType: attachment.mimeType,
        fileSize: attachment.fileSize,
      })),
      comments: "comments" in post
        ? (post.comments as {
            id: string;
            body: string;
            parentId: string | null;
            createdAt: Date;
            // 손님 댓글은 계정이 없어 author가 null입니다. 이 캐스트가 non-null이던 탓에
            // 타입 검사가 잡지 못한 채 내보내기에서 터질 자리였습니다.
            author: { id: string; nameEncrypted: string | null; imageEncrypted: string | null } | null;
            guestName: string | null;
          }[]).map((comment) => ({
            id: comment.id,
            authorName: toCommentAuthorDTO(comment).name,
            body: comment.body,
            parentId: comment.parentId,
            createdAt: comment.createdAt,
          }))
        : [],
      reactionCounts: post.reactions.reduce<Record<string, number>>((counts, reaction) => {
        counts[reaction.key] = (counts[reaction.key] ?? 0) + 1;
        return counts;
      }, {}),
    })),
  };
}
