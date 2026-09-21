import type { QuestionType } from "@/generated/prisma/enums";

const labels: Record<QuestionType, string> = {
  SINGLE_CHOICE: "객관식",
  TRUE_FALSE: "O/X",
  ORDERING: "순서",
  SHORT_ANSWER: "단답형",
  NUMERIC: "숫자",
  PIN_ANCHOR: "핀 고정형",
  SURVEY: "설문",
  WORD_CLOUD: "워드 클라우드",
  DROP_PIN: "드롭 핀",
  LIKERT: "리커트 척도",
  SLIDE: "슬라이드",
};

export function questionTypeLabel(type: QuestionType) {
  return labels[type];
}
