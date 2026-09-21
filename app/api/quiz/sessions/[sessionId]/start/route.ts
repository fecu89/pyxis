import { requireActiveUser } from "@/lib/auth/authorization";
import { apiError, assertSameOrigin } from "@/lib/http";
import { getPrisma } from "@/lib/prisma";
import { loadAsyncParticipation } from "@/lib/quiz/async-session";
import { requireSessionAccess } from "@/lib/quiz/access";

export async function POST(request: Request, { params }: { params: Promise<{ sessionId: string }> }) {
  try {
    assertSameOrigin(request);
    const actor = await requireActiveUser();
    const { sessionId } = await params;
    const access = await requireSessionAccess(sessionId, actor);
    if (!access.participant) throw new Error("학생 참여 정보가 필요합니다.");
    const { session, participant } = await loadAsyncParticipation(sessionId, access.participant.id);

    const prisma = getPrisma();
    if (session.status === "LOBBY") {
      await prisma.quizSession.update({ where: { id: sessionId }, data: { status: "IN_PROGRESS", startedAt: session.startedAt ?? new Date() } });
    }
    if (participant.status === "JOINED") {
      await prisma.sessionParticipant.update({ where: { id: participant.id }, data: { status: "IN_PROGRESS" } });
    }

    return Response.json({
      participantId: participant.id,
      currentQuestionIndex: participant.currentQuestionIndex,
      totalQuestions: session.quiz.questions.length,
    });
  } catch (error) {
    return apiError(error, "과제를 시작하지 못했습니다.");
  }
}
