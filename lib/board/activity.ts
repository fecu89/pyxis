import "server-only";

import type { BoardActivityType } from "@/generated/prisma/client";
import { getPrisma } from "@/lib/prisma";

// 반환하는 id는 SSE 이벤트에 실어 보내는 단조 증가 활동 ID로도 씁니다(padupgrade.md 4.4) —
// 재연결한 클라이언트가 이 id 이후의 활동만 /api/boards/[boardId]/activity로 보충 조회할 수 있습니다.
export async function recordBoardActivity(input: {
  boardId: string;
  actorId?: string | null;
  type: BoardActivityType;
  postId?: string | null;
  commentId?: string | null;
}) {
  const activity = await getPrisma().boardActivity.create({
    data: {
      boardId: input.boardId,
      actorId: input.actorId ?? null,
      type: input.type,
      postId: input.postId ?? null,
      commentId: input.commentId ?? null,
    },
    select: { id: true },
  });
  return activity.id;
}

// 자신이 만든 보드와 초대·승인으로 들어간 보드는 자동으로 팔로우합니다.
export async function followBoard(boardId: string, userId: string) {
  await getPrisma().boardFollow.upsert({
    where: { boardId_userId: { boardId, userId } },
    update: {},
    create: { boardId, userId },
  });
}

/** 학급·교과목 명단처럼 여러 사용자를 한꺼번에 붙일 때 N개의 upsert 왕복을 만들지 않습니다. */
export async function followBoardUsers(boardId: string, userIds: string[]) {
  const uniqueUserIds = [...new Set(userIds)];
  if (!uniqueUserIds.length) return;
  await getPrisma().boardFollow.createMany({
    data: uniqueUserIds.map((userId) => ({ boardId, userId })),
    skipDuplicates: true,
  });
}

export async function unfollowBoard(boardId: string, userId: string) {
  await getPrisma().boardFollow.deleteMany({ where: { boardId, userId } });
}
