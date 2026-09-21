import "server-only";

import type { Prisma } from "@/generated/prisma/client";

/**
 * 소유자 계정이 삭제될 때 그 사람이 소유한 패드를 어떻게 할지 정하는 곳입니다.
 *
 * 패드를 같이 지우지 않는 이유: 패드 내용은 떠나는 한 사람의 것이 아니라 학생들이 쓴 글입니다.
 * 교사 계정 하나를 정리했다고 반 전체 기록이 사라지면 안 되고, 되돌릴 수도 없습니다.
 *
 * 삭제를 무조건 막지 않는 이유: 예전에는 소유 패드가 하나라도 있으면 탈퇴·삭제를 409로 거부했는데,
 * 그러면 전출·퇴직 교사 계정을 영원히 정리할 수 없고 개인정보 파기 요구도 이행할 수 없습니다.
 * (게다가 소유권 이전은 TRANSFER_BOARD_OWNERSHIP 권한이 필요해서, 일반 교사는 자기 패드조차
 * 넘길 수 없었습니다 — 즉 스스로 탈퇴할 방법이 아예 없었습니다.)
 *
 * 그래서 삭제 시점에 소유권을 승계시킵니다:
 *   1) 그 패드의 ADMIN 멤버 중 가장 오래 참여한 활성 사용자
 *   2) 없으면 떠나는 소유자가 속한 학교의 대표교사
 *   3) 그래도 없으면 소유자를 비우고, 살아 있는 패드는 FROZEN으로 바꿔 읽기 전용으로 남깁니다.
 */

export type BoardSuccession = {
  boardId: string;
  title: string;
  /** 승계자 id. 찾지 못해 소유자를 비운 경우 null입니다. */
  successorId: string | null;
  outcome: "ADMIN_MEMBER" | "SCHOOL_REPRESENTATIVE" | "ORPHANED_FROZEN" | "ORPHANED_TRASHED";
};

// 승계는 관리자·본인이 시작한 계정 정리의 뒷정리라서, 승계자의 소유 한도(학생 10 / 교사 40)를
// 넘더라도 진행합니다. 한도 때문에 승계를 포기하면 남는 결과가 "주인 없는 패드"인데, 그게 한도를
// 잠깐 넘기는 것보다 나쁩니다. 대신 감사 로그에 승계 결과를 남겨 관리자가 나중에 정리할 수 있게 합니다.
export async function succeedOwnedBoards(
  tx: Prisma.TransactionClient,
  leavingOwnerId: string,
  // 삭제 절차가 사용자의 schoolId를 지우기 전에 읽어 둔 값이어야 합니다.
  leavingOwnerSchoolId: string | null,
): Promise<BoardSuccession[]> {
  const boards = await tx.board.findMany({
    where: { ownerId: leavingOwnerId },
    select: { id: true, title: true, deletedAt: true },
    orderBy: { createdAt: "asc" },
  });
  if (boards.length === 0) return [];

  const representative = leavingOwnerSchoolId
    ? await tx.user.findFirst({
      where: {
        schoolId: leavingOwnerSchoolId,
        isSchoolRepresentative: true,
        status: "ACTIVE",
        role: { in: ["TEACHER", "ADMIN", "SUPER_ADMIN"] },
        id: { not: leavingOwnerId },
      },
      select: { id: true },
      orderBy: { createdAt: "asc" },
    })
    : null;

  const results: BoardSuccession[] = [];
  for (const board of boards) {
    // 학생은 ADMIN 역할을 받을 수 없으므로(canAssignBoardRole) 이 후보는 교사·관리자뿐입니다.
    const adminMember = await tx.boardMember.findFirst({
      where: {
        boardId: board.id,
        role: "ADMIN",
        userId: { not: leavingOwnerId },
        user: { status: "ACTIVE" },
      },
      select: { userId: true },
      orderBy: { joinedAt: "asc" },
    });
    const successorId = adminMember?.userId ?? representative?.id ?? null;

    if (successorId) {
      await tx.board.update({ where: { id: board.id }, data: { ownerId: successorId } });
      await tx.boardMember.upsert({
        where: { boardId_userId: { boardId: board.id, userId: successorId } },
        update: { role: "OWNER" },
        create: { boardId: board.id, userId: successorId, role: "OWNER" },
      });
      results.push({
        boardId: board.id,
        title: board.title,
        successorId,
        outcome: adminMember ? "ADMIN_MEMBER" : "SCHOOL_REPRESENTATIVE",
      });
      continue;
    }

    // 휴지통에 있는 패드는 얼려도 의미가 없습니다(이미 아무도 못 씁니다). 복구되면 그때
    // 소유자 없는 활성 패드가 되므로, 관리자 큐에는 복구 시점에 나타납니다.
    await tx.board.update({
      where: { id: board.id },
      data: board.deletedAt ? { ownerId: null } : { ownerId: null, state: "FROZEN" },
    });
    results.push({
      boardId: board.id,
      title: board.title,
      successorId: null,
      outcome: board.deletedAt ? "ORPHANED_TRASHED" : "ORPHANED_FROZEN",
    });
  }
  return results;
}

/** 감사 로그 after 페이로드에 넣을 요약입니다. */
export function summarizeSuccessions(successions: BoardSuccession[]) {
  return {
    total: successions.length,
    transferred: successions.filter((item) => item.successorId !== null).length,
    orphaned: successions.filter((item) => item.successorId === null).length,
    boards: successions.map(({ boardId, title, successorId, outcome }) => ({ boardId, title, successorId, outcome })),
  };
}
