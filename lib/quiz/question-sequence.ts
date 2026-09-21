// LIVE 퀴즈 문항 제시 시퀀스의 시간 계산. 카운트다운(3·2·1) → 문항 읽기(보기 숨김) → 답안 공개.
// 서버(socket-server)가 시작 시각을 절대시각으로 계산해 브로드캐스트하고, 클라이언트(호스트·학생)는
// 그 시각을 시계와 비교해 단계를 그리므로, 늦게 들어오거나 재접속해도 같은 장면에 맞춰집니다.
// 미디어 슬라이드는 이 시퀀스를 타지 않습니다 — 감상용 화면이라 바로 표시됩니다.
// 편집기·서버가 함께 쓰는 순수 모듈이라 "server-only"를 붙이지 않습니다.

import { POINT_MULTIPLIER_INTRO_MS, hasPointMultiplierIntro, pointMultiplier } from "@/lib/quiz/point-multiplier";

export const COUNTDOWN_STEP_MS = 850;
export const COUNTDOWN_STEPS = 3;
export const COUNTDOWN_TOTAL_MS = COUNTDOWN_STEP_MS * COUNTDOWN_STEPS;

// 읽기 시간 정책. 짧은 질문도 인지할 시간을 주고, 이미지가 있으면 조금 더 줍니다.
// 문자 수는 String.length가 아니라 서로게이트 페어(이모지 등)를 한 글자로 세는
// Array.from(...).length를 씁니다.
const READING_MIN_MS = 4_500;
const READING_MAX_MS = 12_000;
const READING_BASE_MS = 2_400;
const READING_MS_PER_CHAR = 140;
const READING_IMAGE_BONUS_MS = 1_500;

/** 문항 읽기 시간: 글자 수에 비례하되 너무 짧거나 길지 않게 자르고, 이미지가 있으면 조금 더 줍니다. */
export function readingDurationMs(question: { text: string; imageUrl?: string | null; imagePlaceholder?: string | null }) {
  const charCount = Array.from(question.text.trim()).length;
  const hasImage = Boolean(question.imageUrl || question.imagePlaceholder);
  const textDuration = Math.max(READING_MIN_MS, READING_BASE_MS + charCount * READING_MS_PER_CHAR);
  return Math.min(READING_MAX_MS, textDuration + (hasImage ? READING_IMAGE_BONUS_MS : 0));
}

/** 문항이 화면에 "풀 수 있는 상태"로 열리기까지의 전체 지연. 슬라이드는 0(즉시 표시)입니다. */
export function questionSequenceDelayMs(question: { type: string; text: string; points: number; imageUrl?: string | null; imagePlaceholder?: string | null }) {
  if (question.type === "SLIDE") return 0;
  const multiplierIntro = hasPointMultiplierIntro(question.points) ? POINT_MULTIPLIER_INTRO_MS : 0;
  return multiplierIntro + COUNTDOWN_TOTAL_MS + readingDurationMs(question);
}

export type QuestionSequenceStage = "MULTIPLIER_INTRO" | "COUNTDOWN" | "READING";

/**
 * 절대시각 `nowMs`가 시퀀스의 어느 단계에 있는지 판정하는 순수 함수. 1배 문항은 배수
 * 인트로 자체가 없으므로(`multiplier > 1` 조건), 초기 프레임이라도 곧장 COUNTDOWN으로
 * 판정됩니다 — hydration 직후 한 프레임 동안 `×1`이 나타났다가 사라지는 문제가 이 조건
 * 하나로 막힙니다.
 */
export function sequenceStageAt(
  sequence: { multiplier: number; countdownStartsAt: string; readingStartsAt: string },
  nowMs: number,
): QuestionSequenceStage {
  const countdownStart = new Date(sequence.countdownStartsAt).getTime();
  const readingStart = new Date(sequence.readingStartsAt).getTime();
  if (sequence.multiplier > 1 && nowMs < countdownStart) return "MULTIPLIER_INTRO";
  if (nowMs < readingStart) return "COUNTDOWN";
  return "READING";
}

/** 3·2·1 카운트다운 중 지금 보여야 하는 숫자. readingStart 이후에는 항상 1로 고정됩니다. */
export function countdownStepAt(readingStartsAtMs: number, nowMs: number) {
  return Math.min(COUNTDOWN_STEPS, Math.max(1, Math.ceil((readingStartsAtMs - nowMs) / COUNTDOWN_STEP_MS)));
}

export type QuestionSequencePayload = {
  questionId: string;
  questionIndex: number;
  totalQuestions: number;
  points: number;
  multiplier: number;
  /** 배수 인트로가 끝나고 3·2·1 카운트다운이 시작되는 시각 */
  countdownStartsAt: string;
  /** 질문 텍스트만 보여주는 읽기 단계가 시작되는 시각 */
  readingStartsAt: string;
  /** 보기·타이머가 열리는 시각(= currentQuestionStartedAt) */
  startsAt: string;
  // 읽기 단계에서 필요한 최소 정보만 담습니다. 보기(choices)는 답안 공개 전까지 내려보내지 않습니다.
  text: string;
  imageUrl: string | null;
  imageAlt: string | null;
  imagePlaceholder: string | null;
};

export function buildQuestionSequencePayload(
  question: { id: string; position: number; points: number; text: string; imageUrl: string | null; imageAlt: string | null; imagePlaceholder: string | null },
  totalQuestions: number,
  startsAt: Date,
): QuestionSequencePayload {
  const readingStartsAt = new Date(startsAt.getTime() - readingDurationMs(question));
  const countdownStartsAt = new Date(readingStartsAt.getTime() - COUNTDOWN_TOTAL_MS);
  return {
    questionId: question.id,
    questionIndex: question.position,
    totalQuestions,
    points: question.points,
    multiplier: pointMultiplier(question.points),
    countdownStartsAt: countdownStartsAt.toISOString(),
    readingStartsAt: readingStartsAt.toISOString(),
    startsAt: startsAt.toISOString(),
    text: question.text,
    imageUrl: question.imageUrl,
    imageAlt: question.imageAlt,
    imagePlaceholder: question.imagePlaceholder,
  };
}
