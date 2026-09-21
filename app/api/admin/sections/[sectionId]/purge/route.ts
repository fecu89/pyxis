import { canPurgeSection, getEffectiveBoardAccess, isBoardScopedManagement, requireActiveUser } from "@/lib/auth/authorization";
import { createAuditLogData } from "@/lib/auth/audit";
import { removeStoredAttachmentFiles } from "@/lib/files/cleanup";
import { apiError, assertSameOrigin } from "@/lib/http";
import { getPrisma } from "@/lib/prisma";

export async function DELETE(request: Request, { params }: { params: Promise<{ sectionId: string }> }) {
  try {
    assertSameOrigin(request);
    const user = await requireActiveUser();
    const { sectionId } = await params;
    const prisma = getPrisma();
    const section = await prisma.section.findFirst({
      where: { id: sectionId, deletedAt: { not: null } },
      select: { boardId: true, deletedAt: true, board: { select: { deletedAt: true } } },
    });
    if (!section?.deletedAt || section.board.deletedAt) return Response.json({ error: "먼저 섹션을 삭제해 주세요." }, { status: 409 });
    const access = await getEffectiveBoardAccess(section.boardId, user);
    if (!access || !canPurgeSection(user, access)) return Response.json({ error: "섹션 영구 삭제 권한이 없습니다." }, { status: 403 });
    const attachments = await prisma.attachment.findMany({ where: { post: { sectionId } }, select: { storagePath: true, thumbnailPath: true } });
    const boardScoped = isBoardScopedManagement(access);
    await prisma.$transaction(async (transaction) => {
      await transaction.post.deleteMany({ where: { sectionId } });
      await transaction.section.delete({ where: { id: sectionId } });
      if (!boardScoped) {
        await transaction.adminAuditLog.create({ data: createAuditLogData({ actorId: user.id, action: "GLOBAL_ENTITY_PURGED", entityType: "Section", entityId: sectionId }) });
      }
    });
    const cleanup = await removeStoredAttachmentFiles(attachments);
    return Response.json({ ok: true, purged: true, removedFiles: cleanup.removed, fileCleanupFailed: cleanup.failed });
  } catch (error) {
    return apiError(error, "섹션을 영구 삭제하지 못했습니다.");
  }
}
