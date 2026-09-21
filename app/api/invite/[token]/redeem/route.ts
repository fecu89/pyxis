import { requireActiveUser } from "@/lib/auth/authorization";
import { followBoard, recordBoardActivity } from "@/lib/board/activity";
import { hashInviteToken } from "@/lib/board/invite-links";
import { redeemInviteMembership } from "@/lib/board/redeem-invite";
import { apiError, assertSameOrigin } from "@/lib/http";
import { publishBoardEvent } from "@/lib/realtime/board-events";

export async function POST(request: Request, { params }: { params: Promise<{ token: string }> }) {
  try {
    assertSameOrigin(request);
    const user = await requireActiveUser();
    const { token } = await params;
    const tokenHash = hashInviteToken(token);
    const result = await redeemInviteMembership(tokenHash, user.id);
    if (!result.ok) return Response.json({ error: result.error }, { status: result.status });

    if (result.membershipChanged) {
      const activityId = await recordBoardActivity({ boardId: result.boardId, actorId: user.id, type: "MEMBER_JOINED" });
      publishBoardEvent(result.boardId, { type: "board.updated", entityId: result.boardId, actorId: user.id, activityId });
    }
    await followBoard(result.boardId, user.id);

    return Response.json({ board: { slug: result.boardSlug } });
  } catch (error) {
    return apiError(error, "초대 링크로 참여하지 못했습니다.");
  }
}
