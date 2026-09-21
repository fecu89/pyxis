import "server-only";

import type { Prisma } from "@/generated/prisma/client";

// 퀴즈 세션·패드 보드·설문이 공유하는 활동 레코드를 만듭니다. `/report`와 `/dashboard`가 세
// 테이블을 각자 조회해 응용 코드에서 머지하지 않도록, 목록·필터·집계에 필요한 최소 정보만
// 여기에 복제합니다(prisma/schema/activity.prisma).
//
// 활동을 연 시점의 학교·학급을 고정하는 것이 핵심입니다. 소유자가 학교를 옮기거나 반이 바뀌어도
// 과거 리포트가 따라 움직이면 안 됩니다.

type Client = Prisma.TransactionClient;

type EnsureInput = {
  // 설문은 발행 시각이 startedAt, 마감 시각이 endedAt입니다(세션의 시작·종료와 같은 자리).
  type: "QUIZ_SESSION" | "PAD_BOARD" | "FORM";
  ownerId: string;
  title: string;
  startedAt?: Date | null;
  endedAt?: Date | null;
};

/**
 * 소유자의 현재 소속을 읽어 활동 레코드를 만듭니다. 반드시 대상(보드·세션) 생성과 같은
 * 트랜잭션 안에서 불러야 둘 중 하나만 남는 상태가 생기지 않습니다.
 */
export async function createActivity(tx: Client, input: EnsureInput) {
  const owner = await tx.user.findUnique({
    where: { id: input.ownerId },
    select: { schoolId: true, schoolGroupId: true },
  });
  const activity = await tx.activity.create({
    data: {
      type: input.type,
      ownerId: input.ownerId,
      schoolId: owner?.schoolId ?? null,
      schoolGroupId: owner?.schoolGroupId ?? null,
      title: input.title,
      startedAt: input.startedAt ?? null,
      endedAt: input.endedAt ?? null,
    },
    select: { id: true },
  });
  return activity.id;
}

/**
 * 제목·시작·종료 시각이 바뀌면 활동 레코드도 따라가야 리포트 목록이 어긋나지 않습니다.
 * 활동이 아직 없는 과거 데이터는 조용히 넘어갑니다(activityId가 nullable인 이유).
 */
export async function syncActivity(
  tx: Client,
  activityId: string | null,
  patch: { title?: string; startedAt?: Date | null; endedAt?: Date | null },
) {
  if (!activityId) return;
  await tx.activity.update({ where: { id: activityId }, data: patch });
}
