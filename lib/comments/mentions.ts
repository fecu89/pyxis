import "server-only";

import { getPrisma } from "@/lib/prisma";

export class CommentMentionValidationError extends Error {
  constructor(message = "멘션 대상을 확인해 주세요.") {
    super(message);
    this.name = "CommentMentionValidationError";
  }
}

export async function validateCommentMentionUserIds(input: {
  boardId: string;
  postId: string;
  mentionedUserIds: string[];
}) {
  const ids = Array.from(new Set(input.mentionedUserIds));
  if (ids.length !== input.mentionedUserIds.length) throw new CommentMentionValidationError("멘션 대상이 중복되었습니다.");
  if (!ids.length) return [];
  const prisma = getPrisma();
  const [board, post, commenters, activeUsers] = await Promise.all([
    prisma.board.findUnique({
      where: { id: input.boardId },
      select: { ownerId: true, members: { where: { userId: { in: ids } }, select: { userId: true } } },
    }),
    prisma.post.findUnique({ where: { id: input.postId }, select: { authorId: true } }),
    prisma.comment.findMany({
      where: { postId: input.postId, deletedAt: null, authorId: { in: ids } },
      distinct: ["authorId"],
      select: { authorId: true },
    }),
    prisma.user.findMany({
      where: { id: { in: ids }, status: "ACTIVE" },
      select: { id: true },
    }),
  ]);
  if (!board || !post) throw new CommentMentionValidationError();
  const allowed = new Set([board.ownerId, post.authorId, ...board.members.map((member) => member.userId), ...commenters.map((comment) => comment.authorId)]);
  const active = new Set(activeUsers.map((user) => user.id));
  if (ids.some((id) => !allowed.has(id) || !active.has(id))) {
    throw new CommentMentionValidationError("활성 상태의 패드 참여 사용자만 멘션할 수 있습니다.");
  }
  return ids;
}
