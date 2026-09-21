import { apiError } from "@/lib/http";
import { getPrisma } from "@/lib/prisma";
import { loadAsyncParticipation } from "@/lib/quiz/async-session";
import { requirePublicParticipation } from "@/lib/quiz/guest-access";
import { publicQuestionData } from "@/lib/quiz/public-question";
import { assertPublicQuizApiRateLimit } from "@/lib/security/public-quiz-rate-limit";

export async function GET(request: Request, { params }: { params: Promise<{ sessionId: string }> }) {
  try {
    const { sessionId } = await params;
    const access = await requirePublicParticipation(request, sessionId);
    await assertPublicQuizApiRateLimit(request, access.participant.id);
    const { session, participant } = await loadAsyncParticipation(sessionId, access.participant.id);
    const questions = session.quiz.questions;
    if (participant.currentQuestionIndex >= questions.length) {
      if (participant.status !== "COMPLETED") await getPrisma().sessionParticipant.update({ where: { id: participant.id }, data: { status: "COMPLETED", completedAt: new Date() } });
      return Response.json({ completed: true, totalQuestions: questions.length });
    }
    const question = questions[participant.currentQuestionIndex];
    return Response.json({ completed: false, ...publicQuestionData(question, questions.length, session.quiz.answerPalette) });
  } catch (error) {
    return apiError(error, "공개 퀴즈 문항을 불러오지 못했습니다.");
  }
}
