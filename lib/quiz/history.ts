import "server-only";

import type { QuestionType } from "@/generated/prisma/enums";
import { getPrisma } from "@/lib/prisma";
import { correctAnswerText, submittedAnswerText } from "@/lib/quiz/answer-display";
import { revealedQuestionCount } from "@/lib/quiz/answer-visibility";

// 한 학생의 참여 이력은 참여마다 퀴즈 전문(문항·보기)을 함께 끌고 오므로 무제한 조회하면
// 응답이 급격히 커집니다. 최근 응시부터 이만큼만 돌려주고 나머지는 잘라냅니다.
const HISTORY_LIMIT = 50;

export type HistoryAnswer = {
  questionId: string;
  questionType: QuestionType;
  position: number;
  questionText: string;
  chosenChoiceId: string | null;
  chosenChoiceText: string | null;
  correctChoiceText: string | null;
  answered: boolean;
  isCorrect: boolean;
  pointsAwarded: number;
  maxPoints: number;
  responseTimeMs: number | null;
  answeredAt: Date | null;
};

export type HistoryEntry = {
  participantId: string;
  sessionId: string;
  quizId: string;
  quizTitle: string;
  mode: "LIVE" | "ASYNC";
  score: number;
  maxScore: number;
  status: string;
  joinedAt: Date;
  completedAt: Date | null;
  answers: HistoryAnswer[];
};

// 학생 본인 화면(/report/students/me)과 교사가 특정 학생을 조회하는 화면
// (/report/students/[studentId])이 같은 형태의 이력을 필요로 하므로 조회를 한 곳에 모읍니다.
// 둘 다 서버 컴포넌트에서 직접 부르므로 이 이력을 내려보내는 API 라우트는 없습니다.
export async function getStudentQuizHistory(userId: string): Promise<HistoryEntry[]> {
  const participations = await getPrisma().sessionParticipant.findMany({
    where: { userId },
    orderBy: { joinedAt: "desc" },
    take: HISTORY_LIMIT,
    select: {
      id: true,
      sessionId: true,
      score: true,
      status: true,
      currentQuestionIndex: true,
      joinedAt: true,
      completedAt: true,
      session: {
        select: {
          mode: true,
          status: true,
          livePhase: true,
          currentQuestionIndex: true,
          quiz: { select: { id: true, title: true, questions: { orderBy: { position: "asc" }, select: { id: true, type: true, text: true, position: true, points: true, acceptedAnswers: true, orderedItems: true, numericAnswer: true, likertSteps: true, likertMinLabel: true, likertMaxLabel: true, choices: { orderBy: { position: "asc" }, select: { id: true, text: true, isCorrect: true } } } } } },
        },
      },
      answers: {
        orderBy: { question: { position: "asc" } },
        select: {
          isCorrect: true,
          pointsAwarded: true,
          responseTimeMs: true,
          answeredAt: true,
          textResponse: true,
          selectedChoiceIds: true,
          selectedChoiceTexts: true,
          question: {
            select: {
              id: true,
              type: true,
              text: true,
              position: true,
              acceptedAnswers: true,
              orderedItems: true,
              numericAnswer: true,
              likertSteps: true,
              likertMinLabel: true,
              likertMaxLabel: true,
              choices: { orderBy: { position: "asc" }, select: { id: true, text: true, isCorrect: true } },
            },
          },
          choice: { select: { id: true, text: true } },
        },
      },
    },
  });

  // 문항마다 answers 배열을 훑지 않도록(O(문항×응답)) 참여별로 한 번만 색인해 둡니다.
  const answerByQuestionId = new Map(
    participations.map((participation) => [
      participation.id,
      new Map(participation.answers.map((answer) => [answer.question.id, answer])),
    ]),
  );

  return participations.map((participation) => ({
    participantId: participation.id,
    sessionId: participation.sessionId,
    quizId: participation.session.quiz.id,
    quizTitle: participation.session.quiz.title,
    mode: participation.session.mode,
    score: participation.score,
    maxScore: participation.session.quiz.questions.reduce((sum, question) => sum + question.points, 0),
    status: participation.status,
    joinedAt: participation.joinedAt,
    completedAt: participation.completedAt,
    // 진행 중인 세션이면 아직 공개되지 않은 문항은 이력에서도 제외합니다(정답 선노출 방지).
    answers: participation.session.quiz.questions
      .slice(0, revealedQuestionCount(participation.session, participation, participation.session.quiz.questions.length))
      .map((question) => {
        const answer = answerByQuestionId.get(participation.id)?.get(question.id);
        return {
          questionId: question.id,
          questionType: question.type,
          position: question.position,
          questionText: question.text,
          chosenChoiceId: answer?.choice?.id ?? null,
          chosenChoiceText: submittedAnswerText(question, answer ? { ...answer, choiceId: answer.choice?.id ?? null } : null),
          correctChoiceText: correctAnswerText(question),
          answered: Boolean(answer),
          isCorrect: answer?.isCorrect ?? false,
          pointsAwarded: answer?.pointsAwarded ?? 0,
          maxPoints: question.points,
          responseTimeMs: answer?.responseTimeMs ?? null,
          answeredAt: answer?.answeredAt ?? null,
        };
      }),
  }));
}
