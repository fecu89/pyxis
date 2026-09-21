import { canManageBoardSettings, getEffectiveBoardAccess, isBoardScopedManagement, requireActiveUser } from "@/lib/auth/authorization";
import { createAuditLogData } from "@/lib/auth/audit";
import { sectionSchema } from "@/lib/board/validators";
import { apiError, assertSameOrigin } from "@/lib/http";
import { purgeDeletedPadAttachments } from "@/lib/files/pad-trash-sweep";
import { getPrisma } from "@/lib/prisma";
import { publishBoardEvent } from "@/lib/realtime/board-events";

async function getSection(sectionId: string) {
  return getPrisma().section.findFirst({ where: { id: sectionId, deletedAt: null }, select: { id: true, boardId: true } });
}

export async function PATCH(request: Request, { params }: { params: Promise<{ sectionId: string }> }) {
  try {
    assertSameOrigin(request);
    const user = await requireActiveUser();
    const { sectionId } = await params;
    const section = await getSection(sectionId);
    if (!section) return Response.json({ error: "섹션을 찾을 수 없습니다." }, { status: 404 });
    const access = await getEffectiveBoardAccess(section.boardId, user);
    if (!access || !canManageBoardSettings(user, access)) return Response.json({ error: "섹션 관리 권한이 없습니다." }, { status: 403 });
    const parsed = sectionSchema.safeParse(await request.json());
    if (!parsed.success) return Response.json({ error: "섹션 정보를 확인해 주세요." }, { status: 400 });
    const prisma = getPrisma();
    const updated = await prisma.$transaction(async (tx) => {
      const result = await tx.section.update({
        where: { id: sectionId },
        data: { title: parsed.data.title, description: parsed.data.description || null, version: { increment: 1 } },
        select: { id: true, title: true, description: true, version: true },
      });
      if (!isBoardScopedManagement(access)) {
        await tx.adminAuditLog.create({ data: createAuditLogData({
          actorId: user.id,
          action: "GLOBAL_BOARD_UPDATED",
          entityType: "Section",
          entityId: sectionId,
          after: { boardId: section.boardId, operation: "updated" },
        }) });
      }
      return result;
    });
    publishBoardEvent(section.boardId, {
      type: "section.updated",
      entityId: sectionId,
      sectionId,
      actorId: user.id,
      payload: { sectionPatch: updated },
    });
    return Response.json({ section: updated });
  } catch (error) {
    return apiError(error, "섹션을 수정하지 못했습니다.");
  }
}

export async function DELETE(request: Request, { params }: { params: Promise<{ sectionId: string }> }) {
  try {
    assertSameOrigin(request);
    const user = await requireActiveUser();
    const { sectionId } = await params;
    const section = await getSection(sectionId);
    if (!section) return Response.json({ error: "섹션을 찾을 수 없습니다." }, { status: 404 });
    const access = await getEffectiveBoardAccess(section.boardId, user);
    if (!access || !canManageBoardSettings(user, access)) return Response.json({ error: "섹션 관리 권한이 없습니다." }, { status: 403 });
    const prisma = getPrisma();
    const deletedAt = new Date();
    let deletedAttachments: Array<{ id: string; storagePath: string | null; thumbnailPath: string | null }> = [];
    await prisma.$transaction(async (tx) => {
      await tx.section.update({ where: { id: sectionId }, data: { deletedAt, version: { increment: 1 } } });
      await tx.post.updateMany({ where: { sectionId, deletedAt: null }, data: { deletedAt, version: { increment: 1 } } });
      deletedAttachments = await tx.attachment.findMany({
        where: { post: { sectionId } },
        select: { id: true, storagePath: true, thumbnailPath: true },
      });
      await tx.attachment.updateMany({ where: { post: { sectionId }, deletedAt: null }, data: { deletedAt } });
      if (!isBoardScopedManagement(access)) {
        await tx.adminAuditLog.create({ data: createAuditLogData({
          actorId: user.id,
          action: "GLOBAL_POST_HIDDEN",
          entityType: "Section",
          entityId: sectionId,
          before: { boardId: section.boardId, deletedAt: null },
          after: { boardId: section.boardId, deletedAt: deletedAt.toISOString() },
        }) });
      }
    });
    const cleanup = await purgeDeletedPadAttachments(deletedAttachments);
    publishBoardEvent(section.boardId, { type: "section.deleted", entityId: sectionId, sectionId, actorId: user.id });
    return Response.json({ ok: true, archived: true, fileCleanupFailed: cleanup.failed });
  } catch (error) {
    return apiError(error, "섹션을 삭제하지 못했습니다.");
  }
}
