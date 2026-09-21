export const DEFAULT_QUESTION_POINTS = 1000;
export const POINT_MULTIPLIER_INTRO_MS = 2700;

export type PointMultiplierIntroPayload = {
  questionId: string;
  questionIndex: number;
  totalQuestions: number;
  points: number;
  multiplier: number;
  startsAt: string;
};

export function pointMultiplier(points: number) {
  if (!Number.isFinite(points) || points <= 0) return 0;
  return points / DEFAULT_QUESTION_POINTS;
}

export function hasPointMultiplierIntro(points: number) {
  return pointMultiplier(points) >= 2;
}

export function formatPointMultiplier(points: number) {
  const multiplier = pointMultiplier(points);
  return Number.isInteger(multiplier) ? String(multiplier) : multiplier.toFixed(1).replace(/\.0$/, "");
}
