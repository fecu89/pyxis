import { z } from "zod";
import { canTransferBoardOwnership, requireActiveUser, requireRecentAuthentication } from "@/lib/auth/authorization";
import { createAuditLogData } from "@/lib/auth/audit";
import { assertCanOwnAnotherBoard, BoardOwnershipLimitError } from "@/lib/board/ownership-limit";
import { apiError, assertSameOrigin } from "@/lib/http";
import { getPrisma } from "@/lib/prisma";
import { publishBoardEvent } from "@/lib/realtime/board-events";

const schema = z.object({ newOwnerId: z.string().min(1), reason: z.string().trim().min(3).max(500) });

export async function POST(request: Request, { params }: { params: Promise<{ boardId: string }> }) {
  try {
    assertSameOrigin(request);
    const user = await requireActiveUser();
    if (!canTransferBoardOwnership(user)) return Response.json({ error: "패드 소유권 이전 권한이 없습니다." }, { status: 403 });
    await requireRecentAuthentication(user);
    const parsed = schema.safeParse(await request.json());
    if (!parsed.success) return Response.json({ error: "새 소유자와 변경 사유를 확인해 주세요." }, { status: 400 });
    const { boardId } = await params;
    const prisma = getPrisma();
    const [board, target] = await Promise.all([
      prisma.board.findUnique({ where: { id: boardId }, select: { ownerId: true, deletedAt: true, owner: { select: { role: true } } } }),
      prisma.user.findUnique({ where: { id: parsed.data.newOwnerId }, select: { id: true, role: true, status: true } }),
    ]);
    if (!board || board.deletedAt) return Response.json({ error: "활성 패드를 찾을 수 없습니다." }, { status: 404 });
    if (!target || target.status !== "ACTIVE") return Response.json({ error: "활성 사용자만 소유자가 될 수 있습니다." }, { status: 400 });
    if (board.ownerId === target.id) return Response.json({ error: "이미 패드 소유자입니다." }, { status: 409 });

    await prisma.$transaction(async (transaction) => {
      await assertCanOwnAnotherBoard(transaction, target);
      await transaction.board.update({ where: { id: boardId }, data: { ownerId: target.id, state: "ACTIVE" } });
      await transaction.boardMember.upsert({ where: { boardId_userId: { boardId, userId: target.id } }, update: { role: "OWNER" }, create: { boardId, userId: target.id, role: "OWNER" } });
      // 소유자 승계에 실패해 비어 있던 패드(FROZEN)를 다시 맡기는 경우에는 강등할 이전 소유자가
      // 없습니다. 위 update가 state를 ACTIVE로 되돌려 다시 쓸 수 있게 만듭니다.
      if (board.ownerId && board.owner) {
        const previousOwnerRole = board.owner.role === "STUDENT" ? "MEMBER" : "ADMIN";
        await transaction.boardMember.upsert({ where: { boardId_userId: { boardId, userId: board.ownerId } }, update: { role: previousOwnerRole }, create: { boardId, userId: board.ownerId, role: previousOwnerRole } });
      }
      await transaction.adminAuditLog.create({ data: createAuditLogData({ actorId: user.id, targetUserId: target.id, action: "BOARD_OWNERSHIP_TRANSFERRED", entityType: "Board", entityId: boardId, before: { ownerId: board.ownerId }, after: { ownerId: target.id }, reason: parsed.data.reason }) });
    });
    publishBoardEvent(boardId, { type: "board.updated", entityId: boardId, actorId: user.id });
    return Response.json({ ok: true, ownerId: target.id });
  } catch (error) {
    if (error instanceof BoardOwnershipLimitError) {
      return Response.json({ error: error.message }, { status: error.status });
    }
    return apiError(error, "패드 소유권을 이전하지 못했습니다.");
  }
}
