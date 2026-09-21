import "server-only";

import { getPrisma } from "@/lib/prisma";

const ROLE_RANK = { OWNER: 5, ADMIN: 4, EDITOR: 3, MEMBER: 2, VIEWER: 1 } as const;

export type InviteRedemptionResult =
  | { ok: false; status: 404 | 410; error: string }
  | { ok: true; boardId: string; boardSlug: string; membershipChanged: boolean };

export async function redeemInviteMembership(
  tokenHash: string,
  userId: string,
): Promise<InviteRedemptionResult> {
  return getPrisma().$transaction(async (transaction) => {
    // maxUses 확인과 증가 사이에 다른 요청이 끼지 못하게 링크 행 자체를 잠급니다.
    const locked = await transaction.$queryRaw<Array<{ id: string }>>`
      SELECT "id" FROM "BoardInviteLink" WHERE "tokenHash" = ${tokenHash} FOR UPDATE
    `;
    if (!locked.length) return { ok: false, status: 404, error: "유효하지 않은 초대 링크입니다." };

    const invite = await transaction.boardInviteLink.findUnique({
      where: { id: locked[0].id },
      select: { id: true, boardId: true, role: true, expiresAt: true, maxUses: true, useCount: true, revokedAt: true, board: { select: { slug: true, deletedAt: true } } },
    });
    if (!invite || invite.revokedAt || invite.board.deletedAt) {
      return { ok: false, status: 404, error: "유효하지 않은 초대 링크입니다." };
    }
    if (invite.expiresAt && invite.expiresAt.getTime() < Date.now()) {
      return { ok: false, status: 410, error: "만료된 초대 링크입니다." };
    }

    const existing = await transaction.boardMember.findUnique({
      where: { boardId_userId: { boardId: invite.boardId, userId } },
      select: { role: true },
    });
    const membershipChanged = !existing || ROLE_RANK[existing.role] < ROLE_RANK[invite.role];
    if (membershipChanged) {
      if (invite.maxUses !== null && invite.useCount >= invite.maxUses) {
        return { ok: false, status: 410, error: "사용 횟수를 초과한 초대 링크입니다." };
      }
      await transaction.boardMember.upsert({
        where: { boardId_userId: { boardId: invite.boardId, userId } },
        update: { role: invite.role },
        create: { boardId: invite.boardId, userId, role: invite.role },
      });
      await transaction.boardInviteLink.update({ where: { id: invite.id }, data: { useCount: { increment: 1 } } });
    }
    await transaction.boardAccessRequest.updateMany({
      where: { boardId: invite.boardId, userId, status: "PENDING" },
      data: { status: "APPROVED" },
    });
    return {
      ok: true,
      boardId: invite.boardId,
      boardSlug: invite.board.slug,
      membershipChanged,
    };
  });
}
