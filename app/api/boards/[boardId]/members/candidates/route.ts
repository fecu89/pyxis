import { canManageBoardSettings, getEffectiveBoardAccess, requireActiveUser } from "@/lib/auth/authorization";
import { listBoardMemberCandidates } from "@/lib/board/member-candidates";
import { apiError } from "@/lib/http";
import { getPrisma } from "@/lib/prisma";

// 교사 소유자는 같은 학교, 학생 소유자는 같은 학급 안에서만 초대 후보를 찾습니다. 학생에게
// 학교 전체 디렉터리를 열지 않으면서도 자신이 만든 패드에 반 친구를 초대할 수 있게 합니다.
export async function GET(request: Request, { params }: { params: Promise<{ boardId: string }> }) {
  try {
    const current = await requireActiveUser();
    const { boardId } = await params;
    const access = await getEffectiveBoardAccess(boardId, current);
    if (!access || !canManageBoardSettings(current, access)) {
      return Response.json({ error: "멤버 후보를 볼 권한이 없습니다." }, { status: 403 });
    }
    const query = new URL(request.url).searchParams.get("q") ?? "";
    const prisma = getPrisma();
    const existingMembers = await prisma.boardMember.findMany({ where: { boardId }, select: { userId: true } });
    return Response.json(await listBoardMemberCandidates(current, {
      query,
      excludeUserIds: [...existingMembers.map((member) => member.userId), access.board.ownerId].filter((id): id is string => Boolean(id)),
    }));
  } catch (error) {
    return apiError(error, "멤버 후보를 불러오지 못했습니다.");
  }
}
