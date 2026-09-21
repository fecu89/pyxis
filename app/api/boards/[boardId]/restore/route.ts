import { canRestoreBoard, requireActiveUser } from "@/lib/auth/authorization";
import { createAuditLogData } from "@/lib/auth/audit";
import { getArchivedBoardAccess } from "@/lib/board/permissions";
import { PAD_TRASH_RETENTION_DAYS, PAD_TRASH_RETENTION_MS } from "@/lib/board/trash-policy";
import { apiError, assertSameOrigin } from "@/lib/http";
import { getPrisma } from "@/lib/prisma";
import { publishBoardEvent } from "@/lib/realtime/board-events";

export async function POST(request: Request, { params }: { params: Promise<{ boardId: string }> }) {
  try {
    assertSameOrigin(request);
    const user = await requireActiveUser();
    const { boardId } = await params;
    const access = await getArchivedBoardAccess(boardId, user.id);
    if (!access) return Response.json({ error: "보관된 패드를 찾을 수 없습니다." }, { status: 404 });
    if (!canRestoreBoard(user, access)) return Response.json({ error: "패드 복구 권한이 없습니다." }, { status: 403 });
    if (!access.board.deletedAt || Date.now() - access.board.deletedAt.getTime() > PAD_TRASH_RETENTION_MS) {
      return Response.json({ error: `${PAD_TRASH_RETENTION_DAYS}일 복구 기간이 지났습니다.` }, { status: 410 });
    }
    await getPrisma().$transaction(async (transaction) => {
      await transaction.board.update({ where: { id: boardId }, data: { deletedAt: null } });
      if (!access.isOwner) {
        await transaction.adminAuditLog.create({ data: createAuditLogData({ actorId: user.id, action: "GLOBAL_BOARD_RESTORED", entityType: "Board", entityId: boardId, reason: "전체관리자 패드 복구" }) });
      }
    });
    publishBoardEvent(boardId, { type: "board.updated", entityId: boardId, actorId: user.id });
    return Response.json({ ok: true, restored: true });
  } catch (error) {
    return apiError(error, "패드를 복구하지 못했습니다.");
  }
}
