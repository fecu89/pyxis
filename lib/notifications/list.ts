import "server-only";

import type { Prisma } from "@/generated/prisma/client";
import { getPrisma } from "@/lib/prisma";
import { toPublicAuthorDTO } from "@/lib/users/repository";

function visibleNotificationWhere(userId: string): Prisma.NotificationWhereInput {
  return {
    userId,
    AND: [
      { OR: [{ boardId: null }, { board: { deletedAt: null } }] },
      { OR: [{ quizId: null }, { quiz: { deletedAt: null } }] },
      { OR: [{ formId: null }, { form: { deletedAt: null } }] },
    ],
  };
}

/**
 * 상주 셸은 벨의 배지만 필요합니다. 목록까지 SSR하면 모든 워크스페이스 요청이 알림 20개와
 * 관련 패드·글·퀴즈·설문을 함께 읽게 되므로, 상세 목록은 벨을 처음 열 때 API로 가져옵니다.
 */
export async function getNotificationSummary(userId: string) {
  return {
    notifications: [],
    unreadCount: await getPrisma().notification.count({
      where: { ...visibleNotificationWhere(userId), readAt: null },
    }),
  };
}

export async function getNotificationList(userId: string, limit = 20) {
  const prisma = getPrisma();
  const safeLimit = Math.min(50, Math.max(1, Math.floor(limit) || 20));
  const visible = visibleNotificationWhere(userId);

  const [items, unreadCount] = await Promise.all([
    prisma.notification.findMany({
      where: visible,
      orderBy: { createdAt: "desc" },
      take: safeLimit,
      select: {
        id: true,
        type: true,
        boardId: true,
        postId: true,
        commentId: true,
        quizId: true,
        formId: true,
        accessRequestId: true,
        responseCount: true,
        readAt: true,
        createdAt: true,
        actor: { select: { id: true, nameEncrypted: true, imageEncrypted: true } },
      },
    }),
    prisma.notification.count({ where: { ...visible, readAt: null } }),
  ]);

  const boardIds = [...new Set(items.flatMap((item) => item.boardId ? [item.boardId] : []))];
  const postIds = [...new Set(items.flatMap((item) => item.postId ? [item.postId] : []))];
  const quizIds = [...new Set(items.flatMap((item) => item.quizId ? [item.quizId] : []))];
  const formIds = [...new Set(items.flatMap((item) => item.formId ? [item.formId] : []))];
  const [boards, posts, quizzes, forms] = await Promise.all([
    boardIds.length ? prisma.board.findMany({ where: { id: { in: boardIds } }, select: { id: true, slug: true, title: true } }) : [],
    postIds.length ? prisma.post.findMany({ where: { id: { in: postIds } }, select: { id: true, title: true } }) : [],
    quizIds.length ? prisma.quiz.findMany({ where: { id: { in: quizIds }, deletedAt: null }, select: { id: true, title: true } }) : [],
    formIds.length ? prisma.form.findMany({ where: { id: { in: formIds }, deletedAt: null }, select: { id: true, title: true } }) : [],
  ]);
  const boardById = new Map(boards.map((board) => [board.id, board]));
  const postById = new Map(posts.map((post) => [post.id, post]));
  const quizById = new Map(quizzes.map((quiz) => [quiz.id, quiz]));
  const formById = new Map(forms.map((form) => [form.id, form]));

  return {
    unreadCount,
    notifications: items.map((item) => ({
      id: item.id,
      type: item.type,
      readAt: item.readAt?.toISOString() ?? null,
      createdAt: item.createdAt.toISOString(),
      actor: item.actor ? toPublicAuthorDTO(item.actor) : null,
      board: item.boardId ? boardById.get(item.boardId) ?? null : null,
      accessRequestId: item.accessRequestId,
      post: item.postId ? postById.get(item.postId) ?? null : null,
      quiz: item.quizId ? quizById.get(item.quizId) ?? null : null,
      form: item.formId ? formById.get(item.formId) ?? null : null,
      responseCount: item.responseCount,
      commentId: item.commentId,
    })),
  };
}
