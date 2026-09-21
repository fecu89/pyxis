// NUMERIC 문항 슬라이더의 눈금을 범위와 정답에서 자동으로 계산합니다. 교사가 단위를 지정하지 않아도
// (1) 정답이 반드시 눈금 위에 오고 (2) 충분히 많은 선택지가 나오도록 쪼개는 것이 목적입니다.
// 편집기(클라이언트)·플레이 화면(클라이언트)·문항 페이로드(서버)가 모두 같은 값을 써야 해서
// 순수 함수로만 두고 "server-only"를 붙이지 않습니다.

/** 슬라이더가 최소한 이만큼의 구간(= 눈금 수 - 1)으로 쪼개지도록 단위를 좁혀 갑니다. */
export const MIN_SLIDER_INTERVALS = 20;

// 교실용 문항에 천분위보다 잘게 쓸 일은 없어서, 정답 소수 자릿수를 여기서 끊습니다.
const MAX_ANSWER_DECIMALS = 3;
const MAX_EXTRA_DECIMALS = 6;

function decimalPlaces(value: number) {
  const text = String(value);
  if (text.includes("e") || text.includes("E")) return MAX_ANSWER_DECIMALS;
  const dot = text.indexOf(".");
  return dot === -1 ? 0 : Math.min(MAX_ANSWER_DECIMALS, text.length - dot - 1);
}

// (max - min) / step 은 100 / 0.1 = 999.9999999999999 처럼 한 칸 모자라게 나올 수 있어서
// 나눗셈 오차만큼만 올려 잡고 자릅니다.
function intervalsOf(min: number, max: number, step: number) {
  return Math.floor((max - min) / step + 1e-9);
}

/**
 * 최소·최대·정답에서 슬라이더 눈금을 정합니다. 눈금은 "정답 ± k×단위"로 깔고, 단위는 1-2-5
 * 사다리(…, 1, 2, 5, 10, 20, 50, 100, …)를 굵은 쪽부터 내려오며 범위 안 구간이
 * `MIN_SLIDER_INTERVALS` 이상이 되는 가장 굵은 것을 고릅니다. 슬라이더 양 끝은 범위 안에 남는
 * 가장 바깥 눈금으로 당겨서(min·max가 눈금 위가 아니면 한 단위 미만으로 좁아짐) 모든 정지점이
 * 실제 눈금이 되게 합니다.
 *
 * 정답을 기준점으로 삼는 이유: 예전에는 눈금을 최솟값 기준으로 깔고 "정답이 그 위에 오는"
 * 단위를 찾았는데, 최소 1·최대 99999·정답 50000처럼 범위가 눈금과 어긋나면 어떤 굵은 단위도
 * 조건을 못 넘겨 1 단위(눈금 10만 개)까지 떨어졌습니다. 정답에서 눈금을 시작하면 어떤
 * 입력이든 굵은 단위가 살아남습니다 — 같은 예시가 2000 단위 48칸(2000~98000)이 됩니다.
 */
export function autoNumericGrid(min: number | null, max: number | null, answer: number | null) {
  if (min === null || max === null || !Number.isFinite(min) || !Number.isFinite(max) || max <= min) {
    return { step: 1, intervals: 0, gridMin: min ?? 0, gridMax: max ?? 0 };
  }
  const target = answer !== null && Number.isFinite(answer) ? Math.min(Math.max(answer, min), max) : min;
  const baseDecimals = Math.max(decimalPlaces(min), decimalPlaces(max), decimalPlaces(target));
  const span = max - min;

  const gridAt = (unit: number) => {
    // 정답 아래·위로 범위 안에 들어가는 눈금 수. 나눗셈 오차만큼만 올려 잡습니다.
    const down = Math.floor((target - min) / unit + 1e-9);
    const up = Math.floor((max - target) / unit + 1e-9);
    const decimals = Math.max(decimalPlaces(unit), baseDecimals);
    return {
      step: unit,
      intervals: down + up,
      gridMin: Number((target - down * unit).toFixed(decimals)),
      gridMax: Number((target + up * unit).toFixed(decimals)),
    };
  };

  // 구간 20개를 보장할 수 있는 가장 굵은 단위부터 사다리를 내려옵니다.
  const coarsest = span / MIN_SLIDER_INTERVALS;
  const finestExponent = -(baseDecimals + MAX_EXTRA_DECIMALS + 1);
  let fallback = gridAt(10 ** -baseDecimals);
  for (let exponent = Math.ceil(Math.log10(coarsest)); exponent >= finestExponent; exponent -= 1) {
    for (const mantissa of [5, 2, 1]) {
      // 2 * 10^-3 = 0.0020000000000000005 같은 표현 오차를 정리해 둡니다.
      const unit = Number((mantissa * 10 ** exponent).toPrecision(12));
      if (unit > coarsest * (1 + 1e-9)) continue;
      const grid = gridAt(unit);
      fallback = grid;
      // 양 끝을 눈금으로 당기면서 구간이 최대 2개 깎일 수 있어, 경계 단위는 탈락하고
      // 사다리의 다음 단위가 뽑히기도 합니다.
      if (grid.intervals >= MIN_SLIDER_INTERVALS) return grid;
    }
  }
  // 여기 도달하는 경우는 사실상 없지만(가장 잘게 쪼갠 단위는 항상 구간 조건을 만족),
  // 방어적으로 마지막 후보를 돌려줍니다.
  return fallback;
}

/** 슬라이더가 실제로 밟을 수 있는 눈금 수(양끝 포함). */
export function numericStopCount(min: number, max: number, step: number) {
  if (!(max > min) || !(step > 0)) return 0;
  return intervalsOf(min, max, step) + 1;
}

/**
 * 최솟값을 원점으로 한 눈금에 값을 맞춥니다. `<input type="range">`가 step="any"이던 시절에는
 * 드래그 한 번에 47.32948503948 같은 값이 그대로 답안이 됐습니다. 눈금을 걸어도 남는
 * 부동소수 오차(0.1 * 3 = 0.30000000000000004)까지 여기서 잘라 냅니다.
 */
export function snapNumericValue(value: number, min: number, max: number, step: number) {
  if (!Number.isFinite(value)) return min;
  const resolved = step > 0 ? step : 1;
  const clamped = Math.min(Math.max(value, min), max);
  const snapped = Math.min(min + Math.round((clamped - min) / resolved) * resolved, max);
  return Number(snapped.toFixed(Math.max(decimalPlaces(resolved), decimalPlaces(min))));
}

/** 눈금 표기. 0.5 → "0.5", 1 → "1" */
export function formatNumericStep(step: number) {
  return String(step);
}
