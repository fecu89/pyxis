import { z } from "zod";
import { apiError, assertSameOrigin } from "@/lib/http";
import { readJsonWithLimit } from "@/lib/http-json";
import { getPrisma } from "@/lib/prisma";
import { loadAsyncParticipation } from "@/lib/quiz/async-session";
import { gradeAndRecordAnswer } from "@/lib/quiz/grading";
import { requirePublicParticipation } from "@/lib/quiz/guest-access";
import { assertPublicQuizApiRateLimit } from "@/lib/security/public-quiz-rate-limit";

const bodySchema = z.object({ questionId: z.string().min(1), choiceId: z.string().min(1).nullable().optional(), choiceIds: z.array(z.string().min(1)).max(6).optional(), textResponse: z.string().max(2000).nullable().optional() });
const ANSWER_BODY_MAX_BYTES = 32 * 1024;

export async function POST(request: Request, { params }: { params: Promise<{ sessionId: string }> }) {
  try {
    assertSameOrigin(request);
    const { sessionId } = await params;
    const access = await requirePublicParticipation(request, sessionId);
    await assertPublicQuizApiRateLimit(request, access.participant.id);
    const { questionId, choiceId, choiceIds, textResponse } = bodySchema.parse(await readJsonWithLimit(request, ANSWER_BODY_MAX_BYTES));
    const { session, participant } = await loadAsyncParticipation(sessionId, access.participant.id);
    const questions = session.quiz.questions;
    const expected = questions[participant.currentQuestionIndex];
    if (!expected || expected.id !== questionId) throw new Error("이미 지나갔거나 잘못된 문항입니다.");
    const result = expected.type === "SLIDE" ? { isCorrect: true, pointsAwarded: 0 } : await gradeAndRecordAnswer({ sessionId, participantId: participant.id, questionId, choiceId: choiceId ?? null, choiceIds, textResponse, responseTimeMs: null, mode: "ASYNC", question: expected });
    const nextIndex = participant.currentQuestionIndex + 1;
    const completed = nextIndex >= questions.length;
    await getPrisma().sessionParticipant.update({ where: { id: participant.id }, data: { currentQuestionIndex: nextIndex, ...(completed ? { status: "COMPLETED", completedAt: new Date() } : {}) } });
    return Response.json({ isCorrect: result.isCorrect, pointsAwarded: result.pointsAwarded, nextQuestionIndex: nextIndex, completed });
  } catch (error) {
    return apiError(error, "공개 퀴즈 답안을 제출하지 못했습니다.");
  }
}
