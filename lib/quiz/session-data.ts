import "server-only";

import type { CurrentUser } from "@/lib/auth/current-user";
import type { QuizSession, SessionParticipant } from "@/generated/prisma/client";
import { requireSessionAccess } from "@/lib/quiz/access";
import { requirePublicParticipation } from "@/lib/quiz/guest-access";
import { getPrisma } from "@/lib/prisma";
import { assertPublicQuizApiRateLimit } from "@/lib/security/public-quiz-rate-limit";

async function quizSummary(quizId: string) {
  return getPrisma().quiz.findUnique({
    where: { id: quizId },
    select: { id: true, title: true, _count: { select: { questions: true } } },
  });
}

export async function loadAuthenticatedQuizSessionData(sessionId: string, actor: CurrentUser) {
  const { session, participant } = await requireSessionAccess(sessionId, actor);
  const [quiz, participantCount, participants] = await Promise.all([
    quizSummary(session.quizId),
    getPrisma().sessionParticipant.count({ where: { sessionId } }),
    participant === null
      ? getPrisma().sessionParticipant.findMany({
          where: { sessionId },
          orderBy: { joinedAt: "asc" },
          select: { id: true, nickname: true, score: true, status: true, currentQuestionIndex: true, joinedAt: true },
        })
      : Promise.resolve(undefined),
  ]);
  const isHost = participant === null;
  return {
    session: {
      id: session.id,
      mode: session.mode,
      status: session.status,
      livePhase: session.livePhase,
      currentQuestionIndex: session.currentQuestionIndex,
      pinCode: isHost ? session.pinCode : null,
      openAt: session.openAt,
      dueAt: session.dueAt,
      requiresLogin: session.requiresLogin,
      quiz: { id: quiz?.id, title: quiz?.title ?? "퀴즈", totalQuestions: quiz?._count.questions ?? 0 },
      participantCount,
    },
    participant: participant
      ? { id: participant.id, nickname: participant.nickname, score: participant.score, status: participant.status }
      : null,
    participants: participants?.map((item) => ({ ...item, joinedAt: item.joinedAt.toISOString() })),
  };
}

export async function buildPublicQuizSessionData(session: QuizSession, participant: SessionParticipant) {
  const quiz = await quizSummary(session.quizId);
  return {
    session: {
      id: session.id,
      mode: session.mode,
      status: session.status,
      livePhase: session.livePhase,
      currentQuestionIndex: session.currentQuestionIndex,
      quiz: { id: quiz?.id, title: quiz?.title ?? "퀴즈", totalQuestions: quiz?._count.questions ?? 0 },
    },
    participant: { id: participant.id, nickname: participant.nickname, score: participant.score, status: participant.status },
  };
}

export async function loadPublicQuizSessionData(request: Request, sessionId: string) {
  const { session, participant } = await requirePublicParticipation(request, sessionId);
  await assertPublicQuizApiRateLimit(request, participant.id);
  return buildPublicQuizSessionData(session, participant);
}
