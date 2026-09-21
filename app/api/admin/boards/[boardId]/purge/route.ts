import { canPurgeBoard, requireActiveUser } from "@/lib/auth/authorization";
import { createAuditLogData } from "@/lib/auth/audit";
import { getArchivedBoardAccess } from "@/lib/board/permissions";
import { removeBoardUploadDirectory, removeStoredAttachmentFiles } from "@/lib/files/cleanup";
import { apiError, assertSameOrigin } from "@/lib/http";
import { getPrisma } from "@/lib/prisma";

export async function DELETE(request: Request, { params }: { params: Promise<{ boardId: string }> }) {
  try {
    assertSameOrigin(request);
    const user = await requireActiveUser();
    const { boardId } = await params;
    const access = await getArchivedBoardAccess(boardId, user.id);
    if (!access) return Response.json({ error: "보관된 패드를 찾을 수 없습니다." }, { status: 404 });
    if (!canPurgeBoard(user, access)) return Response.json({ error: "패드 영구 삭제 권한이 없습니다." }, { status: 403 });
    if (!access.board.deletedAt) return Response.json({ error: "먼저 패드를 보관 처리해 주세요." }, { status: 409 });
    const prisma = getPrisma();
    const attachments = await prisma.attachment.findMany({ where: { post: { boardId } }, select: { storagePath: true, thumbnailPath: true } });
    await prisma.$transaction(async (transaction) => {
      // 활동을 지우면 Board.activityId의 cascade로 보드도 함께 내려갑니다. 보드만 지우면
      // 활동 레코드가 고아로 남아 /report에 대상 없는 행으로 뜹니다(FK는 보드 쪽에 있어
      // 반대 방향 cascade를 스키마로 표현할 수 없습니다).
      await transaction.activity.deleteMany({ where: { board: { id: boardId } } });
      if (!access.isOwner) {
        await transaction.adminAuditLog.create({ data: createAuditLogData({ actorId: user.id, action: "GLOBAL_ENTITY_PURGED", entityType: "Board", entityId: boardId }) });
      }
    });
    const cleanup = await removeStoredAttachmentFiles(attachments);
    const boardDirectoryRemoved = await removeBoardUploadDirectory(boardId);
    return Response.json({ ok: true, purged: true, removedFiles: cleanup.removed, fileCleanupFailed: cleanup.failed, boardDirectoryRemoved });
  } catch (error) {
    return apiError(error, "패드를 영구 삭제하지 못했습니다.");
  }
}
