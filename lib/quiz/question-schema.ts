import { z } from "zod";
import { LIKERT_MAX_STEPS, LIKERT_MIN_STEPS } from "@/lib/quiz/likert";
import { isParticipationType } from "@/lib/quiz/participation";
import { pinAreasSchema } from "@/lib/quiz/image-pin-schema";

export const QUESTION_TYPES = [
  "SINGLE_CHOICE",
  "TRUE_FALSE",
  "ORDERING",
  "SHORT_ANSWER",
  "NUMERIC",
  "PIN_ANCHOR",
  "SURVEY",
  "WORD_CLOUD",
  "DROP_PIN",
  "LIKERT",
  "SLIDE",
] as const;

export const SLIDE_LAYOUTS = ["CLASSIC", "BIG_TITLE", "TITLE_TEXT", "BULLETS", "QUOTE", "BIG_MEDIA"] as const;

export const ANSWER_PALETTES = ["BRAND", "SOFT", "FOREST"] as const;

export type EditorQuestionType = (typeof QUESTION_TYPES)[number];
export type EditorSlideLayout = (typeof SLIDE_LAYOUTS)[number];
export type EditorAnswerPalette = (typeof ANSWER_PALETTES)[number];

// 이미지는 이제 파일로 저장되고 이 필드에는 주소만 들어옵니다(POST /api/quiz/quizzes/[id]/images).
// 예전에는 편집기가 canvas로 축소한 base64 data URL이 통째로 들어와서 상한이 700KB였습니다.
//
const QUIZ_IMAGE_PATH = /^\/api\/quiz\/quizzes\/[A-Za-z0-9-]+\/images\/[0-9a-f-]{36}\.(?:webp|jpg)$/i;

export const quizImageUrlSchema = z
  .string()
  .trim()
  .max(2048, "이미지 주소가 너무 깁니다.")
  .refine(
    (value) =>
      QUIZ_IMAGE_PATH.test(value)
      || /^https?:\/\//i.test(value),
    "지원하지 않는 이미지 주소입니다.",
  );

const optionalImageUrl = quizImageUrlSchema.nullable();

export const editorChoiceSchema = z.object({
  id: z.string().min(1).optional(),
  text: z.string().max(200),
  isCorrect: z.boolean(),
});

const sharedQuestionFields = {
  id: z.string().min(1).optional(),
  text: z.string().max(500),
  imageUrl: optionalImageUrl.optional(),
  imageAlt: z.string().max(200).nullable().optional(),
  imagePlaceholder: z.string().max(120).nullable().optional(),
  timeLimitSec: z.number().int().min(5).max(300),
  points: z.number().int().min(0).max(10_000),
};

export const editorQuestionSchema = z.discriminatedUnion("type", [
  z.object({
    ...sharedQuestionFields,
    type: z.literal("SINGLE_CHOICE"),
    multipleSelection: z.boolean(),
    choices: z.array(editorChoiceSchema).min(2).max(6),
  }),
  z.object({
    ...sharedQuestionFields,
    type: z.literal("TRUE_FALSE"),
    choices: z.array(editorChoiceSchema).length(2),
  }),
  z.object({
    ...sharedQuestionFields,
    type: z.literal("ORDERING"),
    orderedItems: z.array(z.string().max(200)).min(2).max(10),
  }),
  z.object({
    ...sharedQuestionFields,
    type: z.literal("SHORT_ANSWER"),
    acceptedAnswers: z.array(z.string().max(200)).max(10),
  }),
  z.object({
    ...sharedQuestionFields,
    type: z.literal("NUMERIC"),
    numericMin: z.number().finite(),
    numericMax: z.number().finite(),
    numericAnswer: z.number().finite(),
  }),
  z.object({
    ...sharedQuestionFields,
    type: z.literal("PIN_ANCHOR"),
    pinAreas: pinAreasSchema,
  }),
  z.object({
    ...sharedQuestionFields,
    type: z.literal("SURVEY"),
    choices: z.array(editorChoiceSchema).min(2).max(6),
    revealResponsesLive: z.boolean(),
  }),
  z.object({
    ...sharedQuestionFields,
    type: z.literal("WORD_CLOUD"),
    revealResponsesLive: z.boolean(),
  }),
  z.object({
    ...sharedQuestionFields,
    type: z.literal("DROP_PIN"),
    revealResponsesLive: z.boolean(),
  }),
  z.object({
    ...sharedQuestionFields,
    type: z.literal("LIKERT"),
    likertSteps: z.number().int().min(LIKERT_MIN_STEPS).max(LIKERT_MAX_STEPS),
    likertMinLabel: z.string().trim().max(40),
    likertMaxLabel: z.string().trim().max(40),
    revealResponsesLive: z.boolean(),
  }),
  z.object({
    ...sharedQuestionFields,
    type: z.literal("SLIDE"),
    slideLayout: z.enum(SLIDE_LAYOUTS),
    slideBody: z.string().max(5000),
  }),
]);

export const editorSaveSchema = z.object({
  title: z.string().trim().min(1).max(120),
  description: z.string().trim().max(2000).nullable(),
  thumbnailUrl: optionalImageUrl.optional(),
  thumbnailAlt: z.string().max(200).nullable().optional(),
  subjectName: z.string().trim().max(60).nullable(),
  requiresLogin: z.boolean(),
  isSearchable: z.boolean().optional().default(false),
  answerPalette: z.enum(ANSWER_PALETTES),
  questions: z.array(editorQuestionSchema).min(1, "문항이 1개 이상 있어야 합니다.").max(100),
});

type PublishableQuestion = {
  type: EditorQuestionType;
  text: string;
  multipleSelection: boolean;
  choices: { text: string; isCorrect: boolean }[];
  acceptedAnswers: string[];
  orderedItems: string[];
  numericMin: number | null;
  numericMax: number | null;
  numericAnswer: number | null;
  imageUrl?: string | null;
  imagePlaceholder?: string | null;
  slideBody?: string | null;
  pinAreas?: unknown;
  likertSteps?: number | null;
  likertMinLabel?: string | null;
  likertMaxLabel?: string | null;
};

export function questionCompletionError(question: PublishableQuestion): string | null {
  if (question.type === "SLIDE") {
    if (!question.text.trim() && !question.slideBody?.trim() && !question.imageUrl && !question.imagePlaceholder) {
      return "슬라이드에 제목, 본문 또는 이미지를 추가해 주세요.";
    }
    return null;
  }
  if (!question.text.trim()) return "질문 내용이 비어 있습니다.";

  if (question.type === "SINGLE_CHOICE") {
    if (question.choices.filter((choice) => choice.text.trim()).length < 2) return "보기를 두 개 이상 채워 주세요.";
    const correctCount = question.choices.filter((choice) => choice.isCorrect && choice.text.trim()).length;
    if (question.multipleSelection && correctCount < 1) return "복수 정답을 한 개 이상 지정해 주세요.";
    if (!question.multipleSelection && correctCount !== 1) return "단일 정답을 정확히 한 개 지정해 주세요.";
  }
  if (question.type === "TRUE_FALSE" && question.choices.filter((choice) => choice.isCorrect).length !== 1) {
    return "O와 X 중 정답 하나를 골라 주세요.";
  }
  if (question.type === "TRUE_FALSE" && question.choices.some((choice) => !choice.text.trim())) {
    return "O/X 보기 내용을 모두 입력해 주세요.";
  }
  if (question.type === "ORDERING" && question.orderedItems.filter((item) => item.trim()).length < 2) {
    return "순서를 맞출 항목을 두 개 이상 채워 주세요.";
  }
  if (question.type === "ORDERING") {
    const items = question.orderedItems.map((item) => item.trim()).filter(Boolean);
    if (new Set(items).size !== items.length) return "순서 항목은 서로 다른 내용으로 입력해 주세요.";
  }
  if (question.type === "SHORT_ANSWER" && !question.acceptedAnswers.some((answer) => answer.trim())) {
    return "허용 정답을 한 개 이상 입력해 주세요.";
  }
  if (question.type === "NUMERIC") {
    if (question.numericMin === null || question.numericMax === null || question.numericAnswer === null) return "숫자 범위와 정답을 입력해 주세요.";
    if (question.numericMin >= question.numericMax) return "최솟값은 최댓값보다 작아야 합니다.";
    if (question.numericAnswer < question.numericMin || question.numericAnswer > question.numericMax) return "정답은 최소~최대 범위 안에 있어야 합니다.";
  }
  if (question.type === "SURVEY" && question.choices.filter((choice) => choice.text.trim()).length < 2) {
    return "설문 보기를 두 개 이상 채워 주세요.";
  }
  // 핀 유형은 배경 이미지가 없으면 어디에 핀을 놓으라는 것인지 알 수 없습니다. 자리표시자
  // (imagePlaceholder)로는 좌표 기준이 서지 않으므로 실제 이미지를 요구합니다.
  if ((question.type === "PIN_ANCHOR" || question.type === "DROP_PIN") && !question.imageUrl) {
    return "핀을 놓을 이미지를 올려 주세요.";
  }
  if (question.type === "PIN_ANCHOR" && !pinAreasSchema.safeParse(question.pinAreas).data?.length) {
    return "정답 영역을 한 개 이상 지정해 주세요.";
  }
  if (question.type === "LIKERT") {
    const steps = question.likertSteps ?? 0;
    if (steps < LIKERT_MIN_STEPS || steps > LIKERT_MAX_STEPS) return `눈금 수는 ${LIKERT_MIN_STEPS}~${LIKERT_MAX_STEPS} 사이여야 합니다.`;
    if (!question.likertMinLabel?.trim() || !question.likertMaxLabel?.trim()) return "척도 양 끝 라벨을 모두 입력해 주세요.";
  }
  return null;
}

/** 참여형은 정답이 없어 "정답 미지정"으로 발행을 막을 이유가 없습니다. 화면에서 안내에 씁니다. */
export function isParticipationQuestionType(type: EditorQuestionType) {
  return isParticipationType(type);
}
