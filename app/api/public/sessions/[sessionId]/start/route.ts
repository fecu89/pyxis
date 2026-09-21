import { apiError, assertSameOrigin } from "@/lib/http";
import { getPrisma } from "@/lib/prisma";
import { loadAsyncParticipation } from "@/lib/quiz/async-session";
import { requirePublicParticipation } from "@/lib/quiz/guest-access";
import { assertPublicQuizApiRateLimit } from "@/lib/security/public-quiz-rate-limit";

export async function POST(request: Request, { params }: { params: Promise<{ sessionId: string }> }) {
  try {
    assertSameOrigin(request);
    const { sessionId } = await params;
    const access = await requirePublicParticipation(request, sessionId);
    await assertPublicQuizApiRateLimit(request, access.participant.id);
    const { session, participant } = await loadAsyncParticipation(sessionId, access.participant.id);
    if (session.status === "LOBBY") await getPrisma().quizSession.update({ where: { id: sessionId }, data: { status: "IN_PROGRESS", startedAt: session.startedAt ?? new Date() } });
    if (participant.status === "JOINED") await getPrisma().sessionParticipant.update({ where: { id: participant.id }, data: { status: "IN_PROGRESS" } });
    return Response.json({ participantId: participant.id, currentQuestionIndex: participant.currentQuestionIndex, totalQuestions: session.quiz.questions.length });
  } catch (error) {
    return apiError(error, "공개 퀴즈를 시작하지 못했습니다.");
  }
}
