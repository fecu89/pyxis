import type { QuestionType } from "@/generated/prisma/enums";
import { parseLikertValue } from "@/lib/quiz/likert";
import { parsePinPoint } from "@/lib/quiz/image-pin";

type DisplayQuestion = {
  type: QuestionType;
  acceptedAnswers: string[];
  orderedItems: string[];
  numericAnswer: number | null;
  likertSteps?: number | null;
  likertMinLabel?: string | null;
  likertMaxLabel?: string | null;
  choices: { id: string; text: string; isCorrect: boolean }[];
};

type DisplayAnswer = {
  textResponse: string | null;
  choiceId?: string | null;
  selectedChoiceIds: string[];
  selectedChoiceTexts?: string[];
};

function formatOrderedResponse(value: string | null) {
  if (!value) return null;
  try {
    const parsed: unknown = JSON.parse(value);
    return Array.isArray(parsed) && parsed.every((item) => typeof item === "string") ? parsed.join(" → ") : value;
  } catch {
    return value;
  }
}

/** 핀 좌표는 사람이 읽을 수 있는 형태가 없어 위치 비율(%)로 풀어 씁니다. */
function formatPinResponse(value: string | null) {
  const point = parsePinPoint(value);
  return point ? `가로 ${Math.round(point.x * 100)}% · 세로 ${Math.round(point.y * 100)}%` : null;
}

const PARTICIPATION_ANSWER_LABELS: Partial<Record<QuestionType, string>> = {
  SURVEY: "정답 없음 (설문)",
  WORD_CLOUD: "정답 없음 (워드 클라우드)",
  DROP_PIN: "정답 없음 (드롭 핀)",
  LIKERT: "정답 없음 (리커트 척도)",
};

export function correctAnswerText(question: DisplayQuestion) {
  if (question.type === "SHORT_ANSWER") return question.acceptedAnswers.join(" / ") || null;
  if (question.type === "ORDERING") return question.orderedItems.join(" → ") || null;
  if (question.type === "NUMERIC") return question.numericAnswer === null ? null : String(question.numericAnswer);
  if (question.type === "PIN_ANCHOR") return "이미지 위 지정 영역";
  const participationLabel = PARTICIPATION_ANSWER_LABELS[question.type];
  if (participationLabel) return participationLabel;
  return question.choices.filter((choice) => choice.isCorrect).map((choice) => choice.text).join(" / ") || null;
}

export function submittedAnswerText(question: DisplayQuestion, answer?: DisplayAnswer | null) {
  if (!answer) return null;
  if (answer.selectedChoiceTexts?.length) return answer.selectedChoiceTexts.join(" / ");
  if (question.type === "ORDERING") return formatOrderedResponse(answer.textResponse);
  if (question.type === "PIN_ANCHOR" || question.type === "DROP_PIN") return formatPinResponse(answer.textResponse);
  if (question.type === "LIKERT") {
    const value = parseLikertValue(answer.textResponse, question.likertSteps ?? 0);
    if (value === null) return null;
    const steps = question.likertSteps ?? 0;
    const edge = value === 1 ? question.likertMinLabel : value === steps ? question.likertMaxLabel : null;
    return edge?.trim() ? `${value}점 (${edge.trim()})` : `${value}점 / ${steps}점`;
  }
  if (question.type === "SHORT_ANSWER" || question.type === "NUMERIC" || question.type === "WORD_CLOUD") return answer.textResponse;
  const ids = answer.selectedChoiceIds.length ? answer.selectedChoiceIds : answer.choiceId ? [answer.choiceId] : [];
  return ids.map((id) => question.choices.find((choice) => choice.id === id)?.text).filter(Boolean).join(" / ") || null;
}
