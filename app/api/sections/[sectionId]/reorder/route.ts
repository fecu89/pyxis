import { canManageBoardSettings, getEffectiveBoardAccess, isBoardFrozen, isBoardScopedManagement, requireActiveUser } from "@/lib/auth/authorization";
import { createAuditLogData } from "@/lib/auth/audit";
import { adjacentInsertionNeighbors, positionBetween } from "@/lib/board/rank";
import { reorderSchema } from "@/lib/board/validators";
import { apiError, assertSameOrigin } from "@/lib/http";
import { getPrisma } from "@/lib/prisma";
import { publishBoardEvent } from "@/lib/realtime/board-events";

export async function POST(request: Request, { params }: { params: Promise<{ sectionId: string }> }) {
  try {
    assertSameOrigin(request);
    const user = await requireActiveUser();
    const { sectionId } = await params;
    const parsed = reorderSchema.safeParse(await request.json());
    if (!parsed.success) return Response.json({ error: "정렬 정보가 올바르지 않습니다." }, { status: 400 });
    const prisma = getPrisma();
    const section = await prisma.section.findFirst({ where: { id: sectionId, deletedAt: null }, select: { boardId: true } });
    if (!section) return Response.json({ error: "섹션을 찾을 수 없습니다." }, { status: 404 });
    const access = await getEffectiveBoardAccess(section.boardId, user);
    if (!access || !canManageBoardSettings(user, access)) return Response.json({ error: "정렬 권한이 없습니다." }, { status: 403 });
    if (isBoardFrozen(access)) return Response.json({ error: "동결된 패드에서는 섹션을 이동할 수 없습니다." }, { status: 409 });

    const moved = await prisma.$transaction(async (tx) => {
      // 생성 라우트와 같은 Board 행을 잠가 섹션 position 계산을 직렬화합니다. 클라이언트가
      // 이웃을 고른 뒤 잠금을 기다리는 동안 목록이 바뀔 수 있으므로 잠금 뒤 최신 배열에서
      // 실제 인접 이웃을 다시 찾습니다.
      await tx.$queryRaw<Array<{ id: string }>>`
        SELECT "id" FROM "Board" WHERE "id" = ${section.boardId} FOR UPDATE
      `;
      const all = await tx.section.findMany({ where: { boardId: section.boardId, deletedAt: null, id: { not: sectionId } }, orderBy: { position: "asc" }, select: { id: true, position: true } });
      const { previous, next } = adjacentInsertionNeighbors(all, parsed.data.previousItemId, parsed.data.nextItemId);
      let position = positionBetween(previous?.position ?? null, next?.position ?? null);
      if (position === null) {
        await Promise.all(all.map((item, index) => tx.section.update({ where: { id: item.id }, data: { position: (index + 1) * 1024 } })));
        const previousIndex = previous ? all.findIndex((item) => item.id === previous.id) : -1;
        const nextIndex = next ? all.findIndex((item) => item.id === next.id) : -1;
        position = positionBetween(previousIndex >= 0 ? (previousIndex + 1) * 1024 : null, nextIndex >= 0 ? (nextIndex + 1) * 1024 : null);
      }
      const updated = await tx.section.update({
        where: { id: sectionId },
        data: { position: position ?? 1024, version: { increment: 1 } },
        select: { id: true, position: true, version: true },
      });
      if (!isBoardScopedManagement(access)) {
        await tx.adminAuditLog.create({ data: createAuditLogData({
          actorId: user.id,
          action: "GLOBAL_BOARD_UPDATED",
          entityType: "Section",
          entityId: sectionId,
          after: { boardId: section.boardId, operation: "reordered" },
        }) });
      }
      return {
        ...updated,
        previousItemId: previous?.id ?? null,
        nextItemId: next?.id ?? null,
      };
    });
    publishBoardEvent(section.boardId, {
      type: "section.reordered",
      entityId: sectionId,
      sectionId,
      actorId: user.id,
      payload: {
        sectionPatch: { id: moved.id, position: moved.position, version: moved.version },
        sectionMove: {
          position: moved.position,
          version: moved.version,
          previousItemId: moved.previousItemId,
          nextItemId: moved.nextItemId,
        },
      },
    });
    return Response.json({ ok: true });
  } catch (error) {
    return apiError(error, "섹션을 정렬하지 못했습니다.");
  }
}
