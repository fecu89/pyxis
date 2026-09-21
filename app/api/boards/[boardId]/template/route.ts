import { z } from "zod";
import { canManageBoardSettings, getEffectiveBoardAccess, requireActiveUser } from "@/lib/auth/authorization";
import { apiError, assertSameOrigin } from "@/lib/http";
import { getPrisma } from "@/lib/prisma";

const templateSchema = z.object({ isTemplate: z.boolean() }).strict();

export async function PATCH(request: Request, { params }: { params: Promise<{ boardId: string }> }) {
  try {
    assertSameOrigin(request);
    const user = await requireActiveUser();
    const { boardId } = await params;
    const parsed = templateSchema.safeParse(await request.json());
    if (!parsed.success) return Response.json({ error: "템플릿 설정을 확인해 주세요." }, { status: 400 });
    const access = await getEffectiveBoardAccess(boardId, user);
    if (!access) return Response.json({ error: "패드를 찾을 수 없습니다." }, { status: 404 });
    if (!canManageBoardSettings(user, access)) return Response.json({ error: "템플릿을 관리할 권한이 없습니다." }, { status: 403 });
    const board = await getPrisma().board.update({
      where: { id: boardId },
      data: { isTemplate: parsed.data.isTemplate },
      select: { id: true, isTemplate: true },
    });
    return Response.json({ board });
  } catch (error) {
    return apiError(error, "템플릿 설정을 저장하지 못했습니다.");
  }
}
