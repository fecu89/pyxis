import "server-only";

import type { NotificationType } from "@/generated/prisma/client";
import { getPrisma } from "@/lib/prisma";
import { isViewingBoard } from "@/lib/realtime/board-viewers";
import { publishUserEvent } from "@/lib/realtime/user-events";

export async function createNotification(input: {
  userId: string;
  actorId?: string | null;
  type: NotificationType;
  boardId?: string | null;
  accessRequestId?: string | null;
  postId?: string | null;
  commentId?: string | null;
}) {
  if (input.actorId && input.actorId === input.userId) return;
  // 접근 요청은 카드의 실시간 변경이 아니라 별도 처리가 필요한 개인 알림입니다.
  // 패드를 보고 있어도 요청 도착·승인·거절 결과를 생략하면 관리자가 요청을 놓칩니다.
  const isAccessRequestNotification = input.type === "ACCESS_REQUEST_RECEIVED"
    || input.type === "ACCESS_REQUEST_APPROVED"
    || input.type === "ACCESS_REQUEST_REJECTED";
  if (!isAccessRequestNotification && input.boardId && isViewingBoard(input.boardId, input.userId)) return;
  const notification = await getPrisma().notification.create({
    data: {
      userId: input.userId,
      actorId: input.actorId ?? null,
      type: input.type,
      boardId: input.boardId ?? null,
      accessRequestId: input.accessRequestId ?? null,
      postId: input.postId ?? null,
      commentId: input.commentId ?? null,
    },
    select: { id: true },
  });
  publishUserEvent(input.userId, { type: "notification.created", notificationId: notification.id });
}
