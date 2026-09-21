import type { AnswerPalette, QuestionType, SlideLayout } from "@/generated/prisma/enums";
import { clampLikertSteps } from "@/lib/quiz/likert";
import { autoNumericGrid } from "@/lib/quiz/numeric";

type PublicQuestionSource = {
  id: string;
  type: QuestionType;
  text: string;
  imageUrl: string | null;
  imageAlt: string | null;
  imagePlaceholder: string | null;
  timeLimitSec: number;
  points: number;
  position: number;
  orderedItems: string[];
  numericMin: number | null;
  numericMax: number | null;
  numericAnswer: number | null;
  multipleSelection: boolean;
  slideLayout: SlideLayout | null;
  slideBody: string | null;
  likertSteps: number | null;
  likertMinLabel: string | null;
  likertMaxLabel: string | null;
  choices: { id: string; text: string; position: number; isCorrect?: boolean }[];
};

function seededShuffle(values: string[], seedText: string) {
  let seed = 2166136261;
  for (const character of seedText) seed = Math.imul(seed ^ character.charCodeAt(0), 16777619);
  const output = [...values];
  for (let index = output.length - 1; index > 0; index -= 1) {
    seed = Math.imul(seed ^ (seed >>> 15), 2246822519);
    const target = Math.abs(seed) % (index + 1);
    [output[index], output[target]] = [output[target], output[index]];
  }
  return output;
}

export function publicQuestionData(question: PublicQuestionSource, totalQuestions: number, answerPalette: AnswerPalette) {
  const numericGrid = question.type === "NUMERIC" ? autoNumericGrid(question.numericMin, question.numericMax, question.numericAnswer) : null;
  return {
    questionId: question.id,
    type: question.type,
    questionIndex: question.position,
    totalQuestions,
    text: question.text,
    imageUrl: question.imageUrl,
    imageAlt: question.imageAlt,
    imagePlaceholder: question.imagePlaceholder,
    choices: question.choices.map((choice) => ({ id: choice.id, text: choice.text, position: choice.position })),
    multipleSelection: question.type === "SINGLE_CHOICE" && question.multipleSelection,
    orderedItems: question.type === "ORDERING" ? seededShuffle(question.orderedItems, question.id) : [],
    // 눈금에 맞춰 정렬한 양 끝을 내려보내고 numericAnswer 자체는 절대 포함하지 않습니다.
    // 정답이 눈금 위에 있다는 것은 어차피 슬라이더에 보이는 정보라, 눈금 배치가 새로 주는
    // 정보는 없습니다.
    numericMin: numericGrid ? numericGrid.gridMin : null,
    numericMax: numericGrid ? numericGrid.gridMax : null,
    numericStep: numericGrid ? numericGrid.step : null,
    slideLayout: question.type === "SLIDE" ? question.slideLayout : null,
    slideBody: question.type === "SLIDE" ? question.slideBody : null,
    // 리커트는 눈금 수와 양 끝 라벨이 있어야 화면을 그릴 수 있습니다. 정답이 없는 유형이라
    // 전부 내려보내도 새는 정보가 없습니다.
    likertSteps: question.type === "LIKERT" ? clampLikertSteps(question.likertSteps) : null,
    likertMinLabel: question.type === "LIKERT" ? question.likertMinLabel : null,
    likertMaxLabel: question.type === "LIKERT" ? question.likertMaxLabel : null,
    // pinAreas(정답 영역)는 어떤 경우에도 내려보내지 않습니다 — 좌표만 알면 개발자 도구로
    // 정답을 그대로 읽을 수 있습니다. 학생 화면은 배경 이미지 위에 핀만 놓습니다.
    timeLimitSec: question.timeLimitSec,
    points: question.points,
    answerPalette,
  };
}
