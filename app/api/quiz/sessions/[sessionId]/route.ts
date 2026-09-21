import { AuthorizationError, canHostOrControlSession, requireActiveUser } from "@/lib/auth/authorization";
import { loadAuthenticatedQuizSessionData } from "@/lib/quiz/session-data";
import { apiError, assertSameOrigin } from "@/lib/http";
import { getPrisma } from "@/lib/prisma";

export async function GET(_request: Request, { params }: { params: Promise<{ sessionId: string }> }) {
  try {
    const actor = await requireActiveUser();
    const { sessionId } = await params;
    return Response.json(await loadAuthenticatedQuizSessionData(sessionId, actor));
  } catch (error) {
    return apiError(error, "세션 정보를 불러오지 못했습니다.");
  }
}

// 세션 결과 삭제. 참여자·응답·할당 기록은 스키마의 onDelete: Cascade로 함께 지워집니다.
// 진행 중(LOBBY·IN_PROGRESS)인 세션은 접속해 있는 참여자 화면이 붕 뜨게 되므로 먼저 종료를 요구합니다.
export async function DELETE(request: Request, { params }: { params: Promise<{ sessionId: string }> }) {
  try {
    assertSameOrigin(request);
    const actor = await requireActiveUser();
    const { sessionId } = await params;

    const session = await getPrisma().quizSession.findUnique({ where: { id: sessionId }, select: { id: true, hostId: true, status: true } });
    if (!session) throw new AuthorizationError("세션을 찾을 수 없습니다.");
    if (!canHostOrControlSession(actor, session)) throw new AuthorizationError("이 세션을 삭제할 권한이 없습니다.");
    if (session.status === "LOBBY" || session.status === "IN_PROGRESS") {
      throw new Error("진행 중인 세션은 먼저 종료한 뒤 삭제할 수 있습니다.");
    }

    // 활동을 지우면 QuizSession.activityId의 cascade로 세션이 함께 내려갑니다. 세션만 지우면
    // 활동 레코드가 고아로 남아 /report에 대상 없는 행으로 뜹니다.
    await getPrisma().activity.deleteMany({ where: { quizSession: { id: sessionId } } });
    return Response.json({ ok: true });
  } catch (error) {
    return apiError(error, "세션을 삭제하지 못했습니다.");
  }
}
