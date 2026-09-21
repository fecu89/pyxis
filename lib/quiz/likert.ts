// 리커트 척도 문항. 눈금 수와 양 끝 라벨만 저장하고 가운데는 번호로 표시합니다 — 눈금마다
// 라벨을 받으면 7단계에서 화면이 라벨로 가득 차고, 출제자도 매번 일곱 개를 채워야 합니다.

export const LIKERT_MIN_STEPS = 3;
export const LIKERT_MAX_STEPS = 10;
export const LIKERT_DEFAULT_STEPS = 5;

/** 자주 쓰는 라벨 조합. 직접 입력도 되므로 여기 없는 축은 출제자가 채워 넣습니다. */
export const LIKERT_PRESETS = [
  { id: "SATISFACTION", label: "불만 ↔ 만족", min: "매우 불만", max: "매우 만족" },
  { id: "AGREEMENT", label: "비동의 ↔ 동의", min: "전혀 아니다", max: "매우 그렇다" },
  { id: "DIFFICULTY", label: "쉬움 ↔ 어려움", min: "매우 쉬움", max: "매우 어려움" },
  { id: "INTEREST", label: "지루함 ↔ 흥미", min: "지루했다", max: "흥미로웠다" },
  { id: "CONFIDENCE", label: "어려움 ↔ 자신 있음", min: "자신 없다", max: "자신 있다" },
  { id: "FREQUENCY", label: "전혀 ↔ 항상", min: "전혀 없다", max: "항상 그렇다" },
] as const;

export type LikertPresetId = (typeof LIKERT_PRESETS)[number]["id"];

export function clampLikertSteps(value: number | null | undefined) {
  if (!Number.isFinite(value ?? NaN)) return LIKERT_DEFAULT_STEPS;
  return Math.min(LIKERT_MAX_STEPS, Math.max(LIKERT_MIN_STEPS, Math.trunc(value as number)));
}

/** 제출값은 1부터 눈금 수까지의 정수입니다. 범위를 벗어나면 null이라 채점부에서 거부합니다. */
export function parseLikertValue(value: string | null | undefined, steps: number): number | null {
  if (value === null || value === undefined || value.trim() === "") return null;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > steps) return null;
  return parsed;
}

/** 응답 분포에서 평균을 냅니다. 응답이 없으면 null(표시할 값 없음)입니다. */
export function likertAverage(counts: number[]): number | null {
  const total = counts.reduce((sum, count) => sum + count, 0);
  if (!total) return null;
  const weighted = counts.reduce((sum, count, index) => sum + count * (index + 1), 0);
  return Math.round((weighted / total) * 100) / 100;
}
