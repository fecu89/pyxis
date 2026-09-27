import "server-only";

import type { Prisma } from "@/generated/prisma/client";
import type { PostData } from "@/components/pad/types";
import { cardCommentSelect, isPostAuthor, toCardCommentDTO, toPostAuthorDTO, type Viewer } from "@/lib/board/post-author";
import { getPrisma } from "@/lib/prisma";
import type { StoredPostFieldValues } from "@/lib/post-fields/types";
import type { ReactionCounts, ReactionKey } from "@/lib/reactions/types";
import { parseReactionKey } from "@/lib/reactions/validation";

/** 첫 패드 조회·추가 페이지·실시간 스냅샷이 공유하는 카드 select입니다. */
export const boardPostCardSelect = {
  id: true,
  sectionId: true,
  title: true,
  body: true,
  bodyFormat: true,
  status: true,
  moderationReason: true,
  customFieldValues: true,
  position: true,
  isPinned: true,
  version: true,
  createdAt: true,
  updatedAt: true,
  author: { select: { id: true, nameEncrypted: true, imageEncrypted: true } },
  guestName: true,
  guestId: true,
  authorId: true,
  attachments: {
    where: { deletedAt: null, commentId: null },
    orderBy: { sortOrder: "asc" },
    select: { id: true, type: true, originalName: true, mimeType: true, fileSize: true, width: true, height: true, imageRevision: true, altText: true, caption: true, externalUrl: true, previewImageUrl: true },
  },
  reactions: { select: { key: true, userId: true } },
  comments: cardCommentSelect,
  _count: { select: { comments: { where: { deletedAt: null } }, reactions: true } },
} satisfies Prisma.PostSelect;

export type BoardPostCardSource = Prisma.PostGetPayload<{ select: typeof boardPostCardSelect }>;

export function boardPostEventDelivery(post: Pick<BoardPostCardSource, "status" | "authorId" | "guestId">) {
  return {
    public: post.status === "PUBLISHED",
    authorUserId: post.authorId,
    authorGuestId: post.guestId,
  };
}

export function boardCommentEventDelivery(
  post: Pick<BoardPostCardSource, "status" | "authorId" | "guestId">,
  comment: { authorId: string | null; guestId: string | null },
) {
  return {
    public: post.status === "PUBLISHED",
    authorUserId: comment.authorId,
    authorGuestId: comment.guestId,
    recipientUserIds: [post.authorId],
    recipientGuestIds: [post.guestId],
  };
}

function reactionSummary(reactions: BoardPostCardSource["reactions"], currentUserId: string | null) {
  const reactionCounts: ReactionCounts = {};
  const viewerReactions: ReactionKey[] = [];
  for (const reaction of reactions) {
    try {
      const key = parseReactionKey(reaction.key);
      reactionCounts[key] = (reactionCounts[key] ?? 0) + 1;
      if (reaction.userId === currentUserId) viewerReactions.push(key);
    } catch {
      continue;
    }
  }
  return {
    viewerReacted: viewerReactions.includes("LIKE"),
    reactionCount: Object.values(reactionCounts).reduce<number>((sum, count) => sum + (count ?? 0), 0),
    viewerReactions,
    reactionCounts,
  };
}

export function serializeBoardPost(post: BoardPostCardSource, viewer: Viewer): PostData {
  const { sectionId: _sectionId, reactions, _count, customFieldValues, guestId, guestName: _guestName, authorId, comments, ...postData } = post;
  void _sectionId; void _guestName;
  return {
    ...postData,
    comments: toCardCommentDTO(comments, viewer),
    customFieldValues: customFieldValues as StoredPostFieldValues | null,
    author: toPostAuthorDTO(post),
    isMine: isPostAuthor({ authorId, guestId }, viewer),
    createdAt: post.createdAt.toISOString(),
    updatedAt: post.updatedAt.toISOString(),
    ...reactionSummary(reactions, viewer.userId),
    commentCount: _count.comments,
  };
}

/** SSE 라우트가 구독자별로 공개 범위를 판정할 카드 스냅샷과 내부 전달 메타데이터입니다. */
export async function readBoardPostEventSnapshot(postId: string) {
  const post = await getPrisma().post.findFirst({
    where: { id: postId, deletedAt: null, board: { deletedAt: null } },
    select: boardPostCardSelect,
  });
  if (!post?.sectionId) return null;
  return {
    sectionId: post.sectionId,
    post: serializeBoardPost(post, { userId: null, guestId: null }),
    delivery: boardPostEventDelivery(post),
  };
}
