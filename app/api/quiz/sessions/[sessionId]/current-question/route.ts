import { requireActiveUser } from "@/lib/auth/authorization";
import { apiError } from "@/lib/http";
import { getPrisma } from "@/lib/prisma";
import { loadAsyncParticipation } from "@/lib/quiz/async-session";
import { requireSessionAccess } from "@/lib/quiz/access";
import { publicQuestionData } from "@/lib/quiz/public-question";

export async function GET(_request: Request, { params }: { params: Promise<{ sessionId: string }> }) {
  try {
    const actor = await requireActiveUser();
    const { sessionId } = await params;
    const access = await requireSessionAccess(sessionId, actor);
    if (!access.participant) throw new Error("학생 참여 정보가 필요합니다.");
    const { session, participant } = await loadAsyncParticipation(sessionId, access.participant.id);

    const questions = session.quiz.questions;
    if (participant.currentQuestionIndex >= questions.length) {
      if (participant.status !== "COMPLETED") {
        await getPrisma().sessionParticipant.update({
          where: { id: participant.id },
          data: { status: "COMPLETED", completedAt: new Date() },
        });
      }
      return Response.json({ completed: true, totalQuestions: questions.length });
    }

    const question = questions[participant.currentQuestionIndex];
    return Response.json({ completed: false, ...publicQuestionData(question, questions.length, session.quiz.answerPalette) });
  } catch (error) {
    return apiError(error, "문항을 불러오지 못했습니다.");
  }
}
