import type { CurrentUser } from "@/lib/auth/current-user";
import { canReadEffectiveBoard, requireActiveUser } from "@/lib/auth/authorization";
import { hasVerifiedBoardPassword } from "@/lib/board/board-password";
import { getBoardAccess } from "@/lib/board/permissions";
import { apiError, assertSameOrigin } from "@/lib/http";
import { getPrisma } from "@/lib/prisma";

async function requireFavoriteAccess(boardId: string, user: CurrentUser) {
  const access = await getBoardAccess(boardId, user.id);
  if (!access || !canReadEffectiveBoard(user, access)) return null;
  if (access.role === null && access.board.passwordHash && !await hasVerifiedBoardPassword(boardId, access.board.passwordHash)) return null;
  return access;
}

export async function GET(_request: Request, { params }: { params: Promise<{ boardId: string }> }) {
  try {
    const user = await requireActiveUser();
    const { boardId } = await params;
    if (!await requireFavoriteAccess(boardId, user)) return Response.json({ error: "패드에 접근할 수 없습니다." }, { status: 403 });
    const favorite = await getPrisma().boardFavorite.findUnique({
      where: { boardId_userId: { boardId, userId: user.id } },
      select: { boardId: true },
    });
    return Response.json({ favorite: Boolean(favorite) }, { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) {
    return apiError(error, "즐겨찾기 상태를 확인하지 못했습니다.");
  }
}

export async function PUT(request: Request, { params }: { params: Promise<{ boardId: string }> }) {
  try {
    assertSameOrigin(request);
    const user = await requireActiveUser();
    const { boardId } = await params;
    if (!await requireFavoriteAccess(boardId, user)) return Response.json({ error: "즐겨찾기할 패드에 접근할 수 없습니다." }, { status: 403 });
    await getPrisma().boardFavorite.upsert({
      where: { boardId_userId: { boardId, userId: user.id } },
      create: { boardId, userId: user.id },
      update: {},
    });
    return Response.json({ favorite: true });
  } catch (error) {
    return apiError(error, "즐겨찾기를 저장하지 못했습니다.");
  }
}

export async function DELETE(request: Request, { params }: { params: Promise<{ boardId: string }> }) {
  try {
    assertSameOrigin(request);
    const user = await requireActiveUser();
    const { boardId } = await params;
    await getPrisma().boardFavorite.deleteMany({ where: { boardId, userId: user.id } });
    return Response.json({ favorite: false });
  } catch (error) {
    return apiError(error, "즐겨찾기를 해제하지 못했습니다.");
  }
}
