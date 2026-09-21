import { canManageBoardSettings, getEffectiveBoardAccess, isBoardScopedManagement, requireActiveUser } from "@/lib/auth/authorization";
import { createAuditLogData } from "@/lib/auth/audit";
import { PAD_TRASH_RETENTION_DAYS, PAD_TRASH_RETENTION_MS } from "@/lib/board/trash-policy";
import { apiError, assertSameOrigin } from "@/lib/http";
import { getPrisma } from "@/lib/prisma";
import { publishBoardEvent } from "@/lib/realtime/board-events";

export async function POST(request: Request, { params }: { params: Promise<{ sectionId: string }> }) {
  try {
    assertSameOrigin(request);
    const user = await requireActiveUser();
    const { sectionId } = await params;
    const prisma = getPrisma();
    const section = await prisma.section.findUnique({
      where: { id: sectionId },
      select: { id: true, boardId: true, title: true, description: true, position: true, version: true, deletedAt: true, board: { select: { deletedAt: true } } },
    });
    if (!section?.deletedAt || section.board.deletedAt) {
      return Response.json({ error: "복구할 섹션을 찾을 수 없습니다." }, { status: 404 });
    }
    if (Date.now() - section.deletedAt.getTime() > PAD_TRASH_RETENTION_MS) {
      return Response.json({ error: `${PAD_TRASH_RETENTION_DAYS}일 복구 기간이 지났습니다.` }, { status: 410 });
    }
    const access = await getEffectiveBoardAccess(section.boardId, user);
    if (!access || !canManageBoardSettings(user, access)) {
      return Response.json({ error: "섹션 복구 권한이 없습니다." }, { status: 403 });
    }
    const previousDeletedAt = section.deletedAt;
    await prisma.$transaction(async (tx) => {
      await tx.section.update({ where: { id: sectionId }, data: { deletedAt: null, version: { increment: 1 } } });
      await tx.post.updateMany({ where: { sectionId, deletedAt: previousDeletedAt }, data: { deletedAt: null, version: { increment: 1 } } });
      if (!isBoardScopedManagement(access)) {
        await tx.adminAuditLog.create({ data: createAuditLogData({
          actorId: user.id,
          action: "GLOBAL_POST_RESTORED",
          entityType: "Section",
          entityId: sectionId,
          before: { boardId: section.boardId, deletedAt: previousDeletedAt.toISOString() },
          after: { boardId: section.boardId, deletedAt: null },
        }) });
      }
    });
    publishBoardEvent(section.boardId, {
      type: "section.created",
      entityId: sectionId,
      sectionId,
      actorId: user.id,
      payload: {
        section: {
          id: section.id,
          title: section.title,
          description: section.description,
          position: section.position,
          version: section.version + 1,
          totalPostCount: 0,
          nextCursor: null,
          posts: [],
        },
        requiresSync: true,
      },
    });
    return Response.json({ ok: true });
  } catch (error) {
    return apiError(error, "섹션을 복구하지 못했습니다.");
  }
}
