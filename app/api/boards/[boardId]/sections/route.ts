import { canManageBoardSettings, getEffectiveBoardAccess, isBoardFrozen, isBoardScopedManagement, requireActiveUser } from "@/lib/auth/authorization";
import { createAuditLogData } from "@/lib/auth/audit";
import { sectionSchema } from "@/lib/board/validators";
import { apiError, assertSameOrigin } from "@/lib/http";
import { getPrisma } from "@/lib/prisma";
import { publishBoardEvent } from "@/lib/realtime/board-events";

export async function POST(request: Request, { params }: { params: Promise<{ boardId: string }> }) {
  try {
    assertSameOrigin(request);
    const user = await requireActiveUser();
    const { boardId } = await params;
    const access = await getEffectiveBoardAccess(boardId, user);
    if (!access || !canManageBoardSettings(user, access)) return Response.json({ error: "섹션 관리 권한이 없습니다." }, { status: 403 });
    if (isBoardFrozen(access)) return Response.json({ error: "동결된 패드에는 섹션을 추가할 수 없습니다." }, { status: 409 });
    const parsed = sectionSchema.safeParse(await request.json());
    if (!parsed.success) return Response.json({ error: "섹션 정보를 확인해 주세요." }, { status: 400 });
    const prisma = getPrisma();
    const section = await prisma.$transaction(async (tx) => {
      // 섹션 생성과 섹션 재정렬은 모두 같은 보드의 position 공간을 씁니다. 보드 행 하나를
      // 공통 잠금으로 잡아 동시에 끝 위치를 읽고 같은 position을 만드는 경쟁을 막습니다.
      await tx.$queryRaw<Array<{ id: string }>>`
        SELECT "id" FROM "Board" WHERE "id" = ${boardId} FOR UPDATE
      `;
      const last = await tx.section.findFirst({ where: { boardId, deletedAt: null }, orderBy: { position: "desc" }, select: { position: true } });
      const created = await tx.section.create({
        data: { boardId, title: parsed.data.title, description: parsed.data.description || null, position: (last?.position ?? 0) + 1024 },
        select: { id: true, title: true, description: true, position: true, version: true },
      });
      if (!isBoardScopedManagement(access)) {
        await tx.adminAuditLog.create({ data: createAuditLogData({
          actorId: user.id,
          action: "GLOBAL_BOARD_UPDATED",
          entityType: "Section",
          entityId: created.id,
          after: { boardId, operation: "created" },
        }) });
      }
      return created;
    });
    publishBoardEvent(boardId, {
      type: "section.created",
      entityId: section.id,
      sectionId: section.id,
      actorId: user.id,
      payload: { section: { ...section, totalPostCount: 0, nextCursor: null, posts: [] } },
    });
    return Response.json({ section: { ...section, posts: [] } }, { status: 201 });
  } catch (error) {
    return apiError(error, "섹션을 만들지 못했습니다.");
  }
}
