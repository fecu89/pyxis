import { canReadEffectiveBoard, getEffectiveBoardAccess, requireActiveUser } from "@/lib/auth/authorization";
import { followBoard, unfollowBoard } from "@/lib/board/activity";
import { apiError, assertSameOrigin } from "@/lib/http";
import { getPrisma } from "@/lib/prisma";

export async function GET(_request: Request, { params }: { params: Promise<{ boardId: string }> }) {
  try {
    const user = await requireActiveUser();
    const { boardId } = await params;
    const follow = await getPrisma().boardFollow.findUnique({ where: { boardId_userId: { boardId, userId: user.id } }, select: { boardId: true } });
    return Response.json({ following: Boolean(follow) });
  } catch (error) {
    return apiError(error, "팔로우 상태를 확인하지 못했습니다.");
  }
}

export async function POST(request: Request, { params }: { params: Promise<{ boardId: string }> }) {
  try {
    assertSameOrigin(request);
    const user = await requireActiveUser();
    const { boardId } = await params;
    const access = await getEffectiveBoardAccess(boardId, user);
    if (!access || !canReadEffectiveBoard(user, access)) return Response.json({ error: "패드 접근 권한이 없습니다." }, { status: 403 });
    await followBoard(boardId, user.id);
    return Response.json({ following: true });
  } catch (error) {
    return apiError(error, "패드를 팔로우하지 못했습니다.");
  }
}

export async function DELETE(request: Request, { params }: { params: Promise<{ boardId: string }> }) {
  try {
    assertSameOrigin(request);
    const user = await requireActiveUser();
    const { boardId } = await params;
    await unfollowBoard(boardId, user.id);
    return Response.json({ following: false });
  } catch (error) {
    return apiError(error, "패드 팔로우를 해제하지 못했습니다.");
  }
}
