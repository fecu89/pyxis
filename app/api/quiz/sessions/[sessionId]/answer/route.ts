import { z } from "zod";
import { requireActiveUser } from "@/lib/auth/authorization";
import { apiError, assertSameOrigin } from "@/lib/http";
import { readJsonWithLimit } from "@/lib/http-json";
import { getPrisma } from "@/lib/prisma";
import { loadAsyncParticipation } from "@/lib/quiz/async-session";
import { gradeAndRecordAnswer } from "@/lib/quiz/grading";
import { requireSessionAccess } from "@/lib/quiz/access";

const bodySchema = z.object({
  questionId: z.string().min(1),
  choiceId: z.string().min(1).nullable().optional(),
  choiceIds: z.array(z.string().min(1)).max(6).optional(),
  textResponse: z.string().max(2000).nullable().optional(),
});
const ANSWER_BODY_MAX_BYTES = 32 * 1024;

export async function POST(request: Request, { params }: { params: Promise<{ sessionId: string }> }) {
  try {
    assertSameOrigin(request);
    const actor = await requireActiveUser();
    const { sessionId } = await params;
    const { questionId, choiceId, choiceIds, textResponse } = bodySchema.parse(await readJsonWithLimit(request, ANSWER_BODY_MAX_BYTES));
    const access = await requireSessionAccess(sessionId, actor);
    if (!access.participant) throw new Error("학생 참여 정보가 필요합니다.");
    const { session, participant } = await loadAsyncParticipation(sessionId, access.participant.id);

    const questions = session.quiz.questions;
    const expected = questions[participant.currentQuestionIndex];
    if (!expected || expected.id !== questionId) {
      throw new Error("이미 지나갔거나 잘못된 문항입니다.");
    }

    const result = expected.type === "SLIDE"
      ? { isCorrect: true, pointsAwarded: 0, alreadyAnswered: false }
      : await gradeAndRecordAnswer({
          sessionId,
          participantId: participant.id,
          questionId,
          choiceId: choiceId ?? null,
          choiceIds,
          textResponse,
          responseTimeMs: null,
          mode: "ASYNC",
          question: expected,
        });

    const nextIndex = participant.currentQuestionIndex + 1;
    const completed = nextIndex >= questions.length;
    await getPrisma().sessionParticipant.update({
      where: { id: participant.id },
      data: {
        currentQuestionIndex: nextIndex,
        ...(completed ? { status: "COMPLETED", completedAt: new Date() } : {}),
      },
    });

    return Response.json({
      isCorrect: result.isCorrect,
      pointsAwarded: result.pointsAwarded,
      nextQuestionIndex: nextIndex,
      completed,
    });
  } catch (error) {
    return apiError(error, "답을 제출하지 못했습니다.");
  }
}
