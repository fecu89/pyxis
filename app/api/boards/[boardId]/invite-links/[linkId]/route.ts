import { canManageBoardSettings, getEffectiveBoardAccess, requireActiveUser } from "@/lib/auth/authorization";
import { apiError, assertSameOrigin } from "@/lib/http";
import { getPrisma } from "@/lib/prisma";

export async function DELETE(request: Request, { params }: { params: Promise<{ boardId: string; linkId: string }> }) {
  try {
    assertSameOrigin(request);
    const current = await requireActiveUser();
    const { boardId, linkId } = await params;
    const access = await getEffectiveBoardAccess(boardId, current);
    if (!access || !canManageBoardSettings(current, access)) {
      return Response.json({ error: "초대 링크를 관리할 권한이 없습니다." }, { status: 403 });
    }
    const result = await getPrisma().boardInviteLink.updateMany({
      where: { id: linkId, boardId, revokedAt: null },
      data: { revokedAt: new Date() },
    });
    if (!result.count) return Response.json({ error: "초대 링크를 찾을 수 없습니다." }, { status: 404 });
    return Response.json({ ok: true });
  } catch (error) {
    return apiError(error, "초대 링크를 폐기하지 못했습니다.");
  }
}
