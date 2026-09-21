import "server-only";

import type { Prisma } from "@/generated/prisma/client";
// 회원 삭제 시 계정 자체의 익명화는 app/api/admin/users/[userId]/route.ts와 app/api/me/route.ts가
// 각자 처리합니다(pad의 loginIdentifier 구조 기준). 이 모듈은 그때 함께 정리해야 하는
// **퀴즈 자산**만 다룹니다 — 소유 퀴즈 승계·동결, 참가자 닉네임 익명화, 주인 잃은 LIVE 세션 종료.
export const DELETED_USER_DISPLAY_NAME = "삭제된 사용자";

/**
 * 참가자 행은 세션 리포트의 참조 무결성 때문에 남기고 표시 이름만 덮어씁니다. 계정을 지워도
 * 과거 세션 결과에 실명이 남아 있으면 안 됩니다.
 */
export async function scrubParticipantNicknames(tx: Prisma.TransactionClient, userIds: string[]) {
  if (!userIds.length) return;
  await tx.sessionParticipant.updateMany({
    where: { userId: { in: userIds } },
    data: { nickname: DELETED_USER_DISPLAY_NAME },
  });
}

/** 이관 대상은 활성 상태의 교사·관리자여야 합니다(학생은 퀴즈를 소유할 수 없습니다). */
export async function resolveTransferTarget(
  tx: Prisma.TransactionClient,
  transferToUserId: string,
  excludeIds: string[],
) {
  if (excludeIds.includes(transferToUserId)) throw new Error("삭제 대상에게는 퀴즈를 이관할 수 없습니다.");
  const successor = await tx.user.findUnique({
    where: { id: transferToUserId },
    select: { id: true, role: true, status: true },
  });
  if (!successor || successor.status !== "ACTIVE" || successor.role === "STUDENT") {
    throw new Error("퀴즈를 이어받을 교사를 찾을 수 없습니다.");
  }
  return successor.id;
}

/** 삭제되는 교사의 퀴즈를 이어받을 기본 후임: 같은 학교의 활성 대표교사. */
export async function findSchoolSuccessor(
  tx: Prisma.TransactionClient,
  target: { id: string; role: string; schoolId: string | null },
  excludeIds: string[] = [],
) {
  if (target.role !== "TEACHER" || !target.schoolId) return null;
  const successor = await tx.user.findFirst({
    where: {
      id: { notIn: [target.id, ...excludeIds] },
      role: "TEACHER",
      status: "ACTIVE",
      isSchoolRepresentative: true,
      schoolId: target.schoolId,
    },
    select: { id: true },
  });
  return successor?.id ?? null;
}

/**
 * 삭제되는 교사의 퀴즈를 후임에게 넘기거나, 후임이 없으면 잠급니다.
 *
 * 예전에는 소프트삭제(deletedAt)로 함께 치웠습니다. 응답 기록 자체는 남았지만 공유받은 동료
 * 교사가 퀴즈를 통째로 잃고, 학생 과제 목록에서도 사라지면서 되돌릴 방법이 없었습니다.
 * 소유자가 스스로 버린 퀴즈(이미 deletedAt이 찍힌 것)는 그대로 둡니다.
 */
export async function transferOrFreezeOwnedQuizzes(
  tx: Prisma.TransactionClient,
  ownerId: string,
  successorId: string | null,
) {
  if (!successorId) {
    const frozen = await tx.quiz.updateMany({
      where: { ownerId, deletedAt: null, frozenAt: null },
      data: { frozenAt: new Date() },
    });
    return { transferred: 0, frozen: frozen.count };
  }

  await moveSubjectsToSuccessor(tx, ownerId, successorId);
  const moved = await tx.quiz.updateMany({
    where: { ownerId, deletedAt: null },
    // 이관받은 퀴즈는 주인이 생겼으므로 잠금을 함께 풉니다(예전 삭제로 잠겨 있던 것 포함).
    data: { ownerId: successorId, frozenAt: null },
  });
  return { transferred: moved.count, frozen: 0 };
}

/**
 * 교과목은 소유자별 이름 공간(`@@unique([ownerId, nameNormalized])`)이라 퀴즈만 넘기면 분류가
 * 남의 과목을 가리킨 채로 남습니다. 후임에게 같은 이름이 이미 있으면 그쪽으로 합치고, 없으면
 * 과목 행 자체를 넘깁니다.
 */
async function moveSubjectsToSuccessor(tx: Prisma.TransactionClient, ownerId: string, successorId: string) {
  const subjects = await tx.subject.findMany({ where: { ownerId }, select: { id: true, nameNormalized: true } });
  for (const subject of subjects) {
    const existing = await tx.subject.findUnique({
      where: { ownerId_nameNormalized: { ownerId: successorId, nameNormalized: subject.nameNormalized } },
      select: { id: true },
    });
    if (!existing) {
      await tx.subject.update({ where: { id: subject.id }, data: { ownerId: successorId } });
      continue;
    }
    await tx.quiz.updateMany({ where: { subjectId: subject.id }, data: { subjectId: existing.id } });
    await tx.subject.delete({ where: { id: subject.id } });
  }
}

/**
 * 호스트가 사라진 실시간 세션은 단계를 넘기거나 종료할 사람이 없어 영원히 진행 중으로 남고,
 * 그 상태로는 세션 삭제도 막혀 있어 정리할 방법이 없습니다. 정상 종료(lib/realtime/socket-server.ts)와
 * 같은 형태로 끝냅니다 — 결과 화면은 그대로 열리고 PIN만 회수됩니다.
 * 자율 풀이(ASYNC)는 호스트 조작 없이도 학생이 끝까지 풀 수 있으므로 건드리지 않습니다.
 */
export async function endStrandedLiveSessions(tx: Prisma.TransactionClient, hostIds: string[]) {
  if (!hostIds.length) return 0;
  const sessions = await tx.quizSession.findMany({
    where: { hostId: { in: hostIds }, mode: "LIVE", status: { in: ["LOBBY", "IN_PROGRESS"] } },
    select: { id: true },
  });
  if (!sessions.length) return 0;
  const sessionIds = sessions.map(({ id }) => id);
  const endedAt = new Date();
  const { count } = await tx.quizSession.updateMany({
    where: { id: { in: sessionIds }, status: { in: ["LOBBY", "IN_PROGRESS"] } },
    data: { status: "FINISHED", livePhase: "ENDED", endedAt, pinCode: null },
  });
  await tx.shortLink.updateMany({
    where: { quizSessionId: { in: sessionIds }, disabledAt: null },
    data: { disabledAt: endedAt },
  });
  return count;
}
