// 참여형 문항의 응답 집계. 실시간 브로드캐스트(소켓), 정답 공개 단계, 리포트가 모두 같은 모양을
// 쓰도록 한 곳에 모읍니다. 집계 형태가 갈리면 "진행 중에 본 분포"와 "리포트에서 본 분포"가
// 달라 보이는데, 그건 버그로만 읽힙니다.
//
// 순수 계산과 조회를 분리해 두었습니다 — buildParticipationSummary는 이미 읽어 온 응답 배열로
// 계산만 하고, DB 조회는 loadParticipationSummary가 맡습니다.

import { getPrisma } from "@/lib/prisma";
import { clampLikertSteps, likertAverage, parseLikertValue } from "@/lib/quiz/likert";
import { parsePinPoint, type PinPoint } from "@/lib/quiz/image-pin";
import { buildWordCloud, type WordCloudEntry } from "@/lib/quiz/word-cloud";

export type ParticipationSummary =
  | { type: "SURVEY"; totalAnswered: number; choiceBreakdown: { choiceId: string; count: number }[] }
  | { type: "WORD_CLOUD"; totalAnswered: number; words: WordCloudEntry[] }
  | { type: "DROP_PIN"; totalAnswered: number; pins: PinPoint[] }
  | { type: "LIKERT"; totalAnswered: number; steps: number; counts: number[]; average: number | null };

type SummarySource = {
  type: string;
  likertSteps: number | null;
  choices: { id: string }[];
};

type SummaryAnswer = {
  choiceId: string | null;
  selectedChoiceIds: string[];
  textResponse: string | null;
};

/** 화면에 찍을 핀 수 상한. 수백 개를 그대로 그리면 이미지가 핀으로 덮여 분포가 안 보입니다. */
export const DROP_PIN_RENDER_LIMIT = 300;

export function buildParticipationSummary(question: SummarySource, answers: SummaryAnswer[]): ParticipationSummary | null {
  if (question.type === "SURVEY") {
    const counts = new Map<string, number>();
    for (const answer of answers) {
      const selected = answer.selectedChoiceIds.length ? answer.selectedChoiceIds : answer.choiceId ? [answer.choiceId] : [];
      for (const choiceId of selected) counts.set(choiceId, (counts.get(choiceId) ?? 0) + 1);
    }
    return {
      type: "SURVEY",
      totalAnswered: answers.length,
      choiceBreakdown: question.choices.map((choice) => ({ choiceId: choice.id, count: counts.get(choice.id) ?? 0 })),
    };
  }

  if (question.type === "WORD_CLOUD") {
    return { type: "WORD_CLOUD", totalAnswered: answers.length, words: buildWordCloud(answers.map((answer) => answer.textResponse)) };
  }

  if (question.type === "DROP_PIN") {
    const pins = answers
      .map((answer) => parsePinPoint(answer.textResponse))
      .filter((pin): pin is PinPoint => pin !== null);
    return { type: "DROP_PIN", totalAnswered: answers.length, pins: pins.slice(-DROP_PIN_RENDER_LIMIT) };
  }

  if (question.type === "LIKERT") {
    const steps = clampLikertSteps(question.likertSteps);
    const counts = Array.from({ length: steps }, () => 0);
    for (const answer of answers) {
      const value = parseLikertValue(answer.textResponse, steps);
      if (value !== null) counts[value - 1] += 1;
    }
    return { type: "LIKERT", totalAnswered: answers.length, steps, counts, average: likertAverage(counts) };
  }

  return null;
}

export async function loadParticipationSummary(sessionId: string, question: SummarySource & { id: string }) {
  const answers = await getPrisma().answer.findMany({
    where: { sessionId, questionId: question.id },
    select: { choiceId: true, selectedChoiceIds: true, textResponse: true },
  });
  return buildParticipationSummary(question, answers);
}
