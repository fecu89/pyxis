import "server-only";

import { followBoardUsers, recordBoardActivity } from "@/lib/board/activity";
import { getPrisma } from "@/lib/prisma";
import { publishBoardEvent } from "@/lib/realtime/board-events";
import { rosterMemberWhere } from "@/lib/subjects/roster";
import type { CurrentUser } from "@/lib/auth/current-user";
import { canAssignStudentsToCourses } from "@/lib/subjects/scope";

/**
 * 패드가 교과목에 새로 연결되는 순간, 그 교과목 명단(개별 배정 ∪ 연결 학급)의 학생 전체를
 * 한 번에 멤버로 추가합니다. 1회성입니다 — 이후 명단이 바뀌어도 자동으로 반영되지 않고,
 * 이미 멤버인 학생은 건드리지 않습니다. `app/api/boards/[boardId]/members/groups/route.ts`의
 * 학급·부서 일괄 추가와 같은 패턴(createMany + skipDuplicates, 부수효과도 일괄 처리)입니다.
 */
export async function inviteSubjectRosterToBoard(boardId: string, subjectId: string, actor: Pick<CurrentUser, "id" | "role">) {
  // 개인 분류는 학생도 사용하지만, 과거 소유 명단을 읽거나 일괄 초대할 권한은 주지 않습니다.
  if (!canAssignStudentsToCourses(actor)) return { addedCount: 0 };
  const actorId = actor.id;
  const prisma = getPrisma();
  const [board, existingMembers, students] = await Promise.all([
    prisma.board.findUnique({ where: { id: boardId }, select: { ownerId: true } }),
    prisma.boardMember.findMany({ where: { boardId }, select: { userId: true } }),
    prisma.user.findMany({ where: rosterMemberWhere(subjectId), select: { id: true } }),
  ]);
  const excluded = new Set([...existingMembers.map((member) => member.userId), board?.ownerId].filter((id): id is string => Boolean(id)));
  const targets = students.filter((student) => !excluded.has(student.id));
  if (!targets.length) return { addedCount: 0 };

  const { count: addedCount } = await prisma.$transaction(async (tx) => {
    const result = await tx.boardMember.createMany({
      data: targets.map((target) => ({ boardId, userId: target.id, role: "MEMBER" as const })),
      skipDuplicates: true,
    });
    if (result.count) {
      await tx.boardAccessRequest.updateMany({
        where: { boardId, userId: { in: targets.map((target) => target.id) }, status: "PENDING" },
        data: { status: "APPROVED" },
      });
    }
    return result;
  });

  // 같은 연결 요청이 동시에 들어오면 양쪽이 같은 targets를 읽을 수 있지만 createMany에서
  // 한쪽만 이깁니다. 진 쪽은 동일한 활동/SSE를 한 번 더 만들지 않고 저장 결과에 수렴합니다.
  if (!addedCount) return { addedCount: 0 };

  const [activityId] = await Promise.all([
    recordBoardActivity({ boardId, actorId, type: "MEMBER_JOINED", postId: null }),
    followBoardUsers(boardId, targets.map((target) => target.id)),
  ]);
  publishBoardEvent(boardId, { type: "board.updated", entityId: boardId, actorId, activityId });

  return { addedCount };
}
