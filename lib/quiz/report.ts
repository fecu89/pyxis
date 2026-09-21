import { requireSessionAccess } from "@/lib/quiz/access";
import { canManageStudent } from "@/lib/auth/authorization";
import type { CurrentUser } from "@/lib/auth/current-user";
import { getPrisma } from "@/lib/prisma";
import { correctAnswerText, submittedAnswerText } from "@/lib/quiz/answer-display";
import { revealedQuestionCount } from "@/lib/quiz/answer-visibility";
import { isPinType } from "@/lib/quiz/participation";
import { buildParticipationSummary, DROP_PIN_RENDER_LIMIT } from "@/lib/quiz/participation-summary";
import { parsePinAreas, parsePinPoint } from "@/lib/quiz/image-pin";

export async function buildSessionReport(sessionId: string, actor: CurrentUser) {
  const { session, participant } = await requireSessionAccess(sessionId, actor);
  const isHost = participant === null;

  const quiz = await getPrisma().quiz.findUnique({
    where: { id: session.quizId },
    select: {
      title: true,
      questions: {
        orderBy: { position: "asc" },
        select: {
          id: true,
          type: true,
          text: true,
          position: true,
          points: true,
          acceptedAnswers: true,
          orderedItems: true,
          numericAnswer: true,
          likertSteps: true,
          likertMinLabel: true,
          likertMaxLabel: true,
          imageUrl: true,
          imageAlt: true,
          pinAreas: true,
          choices: { orderBy: { position: "asc" }, select: { id: true, text: true, isCorrect: true } },
        },
      },
    },
  });
  if (!quiz) throw new Error("퀴즈를 찾을 수 없습니다.");

  if (!isHost) {
    const answers = await getPrisma().answer.findMany({
      where: { sessionId, participantId: participant.id },
      select: {
        isCorrect: true,
        pointsAwarded: true,
        responseTimeMs: true,
        answeredAt: true,
        textResponse: true,
        selectedChoiceIds: true,
        selectedChoiceTexts: true,
        question: { select: { id: true, text: true, position: true } },
        choice: { select: { id: true, text: true } },
      },
    });
    const answerByQuestion = new Map(answers.map((a) => [a.question.id, a]));
    // 진행 중인 세션에서는 아직 공개되지 않은 문항을 아예 내려보내지 않습니다(정답 선노출 방지).
    const revealedCount = revealedQuestionCount(session, participant, quiz.questions.length);
    const revealedQuestions = quiz.questions.slice(0, revealedCount);

    return {
      scope: "SELF" as const,
      quizTitle: quiz.title,
      mode: session.mode,
      score: participant.score,
      maxScore: quiz.questions.reduce((sum, question) => sum + question.points, 0),
      joinedAt: participant.joinedAt,
      completedAt: participant.completedAt,
      pendingQuestionCount: quiz.questions.length - revealedCount,
      questions: revealedQuestions.map((q) => {
        const answer = answerByQuestion.get(q.id);
        return {
          questionId: q.id,
          questionType: q.type,
          position: q.position,
          text: q.text,
          correctChoiceText: correctAnswerText(q),
          chosenChoiceText: submittedAnswerText(q, answer ? { ...answer, choiceId: answer.choice?.id ?? null } : null),
          isCorrect: answer?.isCorrect ?? false,
          pointsAwarded: answer?.pointsAwarded ?? 0,
          maxPoints: q.points,
          responseTimeMs: answer?.responseTimeMs ?? null,
          answeredAt: answer?.answeredAt ?? null,
          answered: Boolean(answer),
        };
      }),
    };
  }

  const answers = await getPrisma().answer.findMany({
    where: { sessionId },
    select: {
      isCorrect: true,
      choiceId: true,
      textResponse: true,
      selectedChoiceIds: true,
      selectedChoiceTexts: true,
      responseTimeMs: true,
      pointsAwarded: true,
      question: { select: { id: true } },
      participant: { select: { id: true, nickname: true } },
    },
  });
  const participants = await getPrisma().sessionParticipant.findMany({ where: { sessionId }, orderBy: { score: "desc" }, select: { id: true, userId: true, nickname: true, score: true, status: true, joinedAt: true, completedAt: true, user: { select: { schoolId: true } } } });
  const participantCount = participants.length;

  // 문항·참여자마다 전체 응답 배열을 다시 훑으면 O(문항×응답)+O(참여자×응답)이 되므로 한 번만 묶어 둡니다.
  const answersByQuestion = new Map<string, typeof answers>();
  const answersByParticipant = new Map<string, typeof answers>();
  for (const answer of answers) {
    const forQuestion = answersByQuestion.get(answer.question.id) ?? [];
    forQuestion.push(answer);
    answersByQuestion.set(answer.question.id, forQuestion);

    const forParticipant = answersByParticipant.get(answer.participant.id) ?? [];
    forParticipant.push(answer);
    answersByParticipant.set(answer.participant.id, forParticipant);
  }

  const questions = quiz.questions.map((question) => {
    const questionAnswers = answersByQuestion.get(question.id) ?? [];
    // 보기 분포를 낼 수 있는 건 보기가 있는 유형뿐입니다(객관식·O/X·설문). 나머지는 제출 원문만 남습니다.
    const isTextAnswer = !question.choices.length;

    const selectionCount = new Map<string, number>();
    if (!isTextAnswer) {
      for (const answer of questionAnswers) {
        const selected = answer.selectedChoiceIds.length ? answer.selectedChoiceIds : answer.choiceId ? [answer.choiceId] : [];
        for (const choiceId of selected) selectionCount.set(choiceId, (selectionCount.get(choiceId) ?? 0) + 1);
      }
    }
    const choiceBreakdown = isTextAnswer
      ? []
      : question.choices.map((choice) => ({
          choiceId: choice.id,
          text: choice.text,
          isCorrect: choice.isCorrect,
          count: selectionCount.get(choice.id) ?? 0,
        }));

    const wrongAnswers = questionAnswers
      .filter((a) => !a.isCorrect)
      .map((a) => ({
        participantId: a.participant.id,
        nickname: a.participant.nickname,
        chosenChoiceText: submittedAnswerText(question, a) ?? "(무응답)",
        responseTimeMs: a.responseTimeMs,
      }));

    return {
      questionId: question.id,
      questionType: question.type,
      position: question.position,
      text: question.text,
      correctChoiceText: correctAnswerText(question),
      correctAnswers: question.type === "SHORT_ANSWER" ? question.acceptedAnswers : undefined,
      answeredCount: questionAnswers.length,
      unansweredCount: Math.max(0, participantCount - questionAnswers.length),
      choiceBreakdown,
      wrongAnswers,
      // 참여형은 보기 분포로 표현할 수 없어 유형별 집계를 그대로 실어 보냅니다. 수업이 끝난 뒤
      // 리포트에서만 결과를 다시 보는 경우가 많아, 진행 화면과 같은 그림을 볼 수 있어야 합니다.
      participationSummary: buildParticipationSummary(question, questionAnswers),
      // 핀 고정형은 정답 영역과 각자 놓은 위치를 이미지 위에 다시 그립니다.
      pinResult: question.type === "PIN_ANCHOR"
        ? {
            pinAreas: parsePinAreas(question.pinAreas),
            pins: questionAnswers
              .map((answer) => ({ point: parsePinPoint(answer.textResponse), isCorrect: answer.isCorrect }))
              .flatMap((pin) => (pin.point ? [{ point: pin.point, isCorrect: pin.isCorrect }] : []))
              .slice(0, DROP_PIN_RENDER_LIMIT),
          }
        : null,
      imageUrl: isPinType(question.type) ? question.imageUrl : null,
      imageAlt: isPinType(question.type) ? question.imageAlt : null,
    };
  });

  const participantResults = participants.map((entry) => {
    const ownAnswers = answersByParticipant.get(entry.id) ?? [];
    return {
      participantId: entry.id,
      userId: entry.userId,
      nickname: entry.nickname,
      isGuest: entry.userId === null,
      // 링크를 띄울지는 실제로 /api/students/[id]/history가 통과시킬 조건과 같은 함수로 판정합니다.
      canViewHistory: entry.userId !== null && entry.user !== null && canManageStudent(actor, entry.user),
      score: entry.score,
      status: entry.status,
      joinedAt: entry.joinedAt,
      completedAt: entry.completedAt,
      correctCount: ownAnswers.filter((answer) => answer.isCorrect).length,
      answeredCount: ownAnswers.length,
      totalQuestions: quiz.questions.length,
      averageResponseTimeMs: (() => {
        const timed = ownAnswers.filter((answer) => answer.responseTimeMs !== null);
        return timed.length ? Math.round(timed.reduce((sum, answer) => sum + (answer.responseTimeMs ?? 0), 0) / timed.length) : null;
      })(),
    };
  });

  return { scope: "HOST" as const, quizTitle: quiz.title, mode: session.mode, participantCount, participants: participantResults, questions };
}

export async function buildParticipantSessionReport(sessionId: string, participantId: string) {
  const [participant, quiz] = await Promise.all([
    getPrisma().sessionParticipant.findFirst({ where: { id: participantId, sessionId } }),
    getPrisma().quizSession.findUnique({
      where: { id: sessionId },
      select: {
        mode: true,
        status: true,
        livePhase: true,
        currentQuestionIndex: true,
        quiz: {
          select: {
            title: true,
            questions: {
              orderBy: { position: "asc" },
              select: { id: true, type: true, text: true, position: true, points: true, acceptedAnswers: true, orderedItems: true, numericAnswer: true, likertSteps: true, likertMinLabel: true, likertMaxLabel: true, choices: { orderBy: { position: "asc" }, select: { id: true, text: true, isCorrect: true } } },
            },
          },
        },
      },
    }),
  ]);
  if (!participant || !quiz) throw new Error("참여 기록을 찾을 수 없습니다.");
  const answers = await getPrisma().answer.findMany({
    where: { sessionId, participantId },
    select: { isCorrect: true, pointsAwarded: true, responseTimeMs: true, answeredAt: true, textResponse: true, selectedChoiceIds: true, selectedChoiceTexts: true, question: { select: { id: true } }, choice: { select: { id: true, text: true } } },
  });
  const answerByQuestion = new Map(answers.map((answer) => [answer.question.id, answer]));
  const revealedCount = revealedQuestionCount(quiz, participant, quiz.quiz.questions.length);
  return {
    scope: "SELF" as const,
    quizTitle: quiz.quiz.title,
    mode: quiz.mode,
    score: participant.score,
    maxScore: quiz.quiz.questions.reduce((sum, question) => sum + question.points, 0),
    joinedAt: participant.joinedAt,
    completedAt: participant.completedAt,
    pendingQuestionCount: quiz.quiz.questions.length - revealedCount,
    questions: quiz.quiz.questions.slice(0, revealedCount).map((question) => {
      const answer = answerByQuestion.get(question.id);
      return {
        questionId: question.id,
        questionType: question.type,
        position: question.position,
        text: question.text,
        correctChoiceText: correctAnswerText(question),
        chosenChoiceText: submittedAnswerText(question, answer ? { ...answer, choiceId: answer.choice?.id ?? null } : null),
        isCorrect: answer?.isCorrect ?? false,
        pointsAwarded: answer?.pointsAwarded ?? 0,
        maxPoints: question.points,
        responseTimeMs: answer?.responseTimeMs ?? null,
        answeredAt: answer?.answeredAt ?? null,
        answered: Boolean(answer),
      };
    }),
  };
}

export type HostSessionReport = Extract<Awaited<ReturnType<typeof buildSessionReport>>, { scope: "HOST" }>;
