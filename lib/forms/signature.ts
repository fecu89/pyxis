// 서명 필드의 좌표계. 화면·검증·인쇄가 모두 이 모듈만 씁니다.
//
// 모든 값은 서명 상자 좌상단을 (0,0), 우하단을 (1,1)로 두는 정규화 좌표입니다. 원본 픽셀을
// 저장하면 그린 기기의 화면 크기에 따라 서명이 커지거나 잘리므로, 저장·표시가 전부 이 비율
// 좌표만 씁니다(lib/quiz/image-pin.ts와 같은 이유).
//
// 왜 이미지 파일이 아니라 좌표인가 — 응답마다 파일이 생기면 저장소 한도, 미참조 파일 정리
// 스위퍼, 열람 권한 검사가 전부 새로 필요합니다(퀴즈 이미지에 그 셋을 붙인 코드가 500줄이
// 넘습니다). 벡터는 확대해도 깨지지 않아 인쇄에 유리하고, 서명은 인쇄되는 것이 목적입니다.
// XLSX·PDF에 래스터가 필요해지면 그때 서버에서 SVG를 PNG로 굽습니다 — 저장 형식은 그대로 둡니다.

export const SIGNATURE_MAX_STROKE_DURATION_MS = 10 * 60 * 1000;

export type SignaturePoint = {
  x: number;
  y: number;
  /** signature_pad가 수집합니다. 기존 {x,y} 데이터도 계속 읽도록 선택값입니다. */
  pressure?: number;
  /** 획 시작부터의 상대 밀리초입니다. */
  time?: number;
};

export const SIGNATURE_MAX_STROKES = 50;
export const SIGNATURE_MAX_POINTS_PER_STROKE = 2000;

/** 획 하나는 펜을 대고 뗄 때까지의 점들입니다. 한 점짜리 획은 signature_pad의 점으로 그립니다. */
export type SignatureStroke = SignaturePoint[];
export type SignatureStrokes = SignatureStroke[];

/** DB의 Json 컬럼에는 무엇이든 들어올 수 있으므로 읽을 때마다 검증합니다. 깨진 값은 빈 배열입니다. */
export function parseSignatureStrokes(value: unknown): SignatureStrokes {
  if (!Array.isArray(value) || value.length > SIGNATURE_MAX_STROKES) return [];
  const strokes: SignatureStrokes = [];
  for (const rawStroke of value) {
    if (!Array.isArray(rawStroke) || rawStroke.length < 1 || rawStroke.length > SIGNATURE_MAX_POINTS_PER_STROKE) return [];
    const stroke: SignatureStroke = [];
    for (const rawPoint of rawStroke) {
      if (!rawPoint || typeof rawPoint !== "object") return [];
      const point = rawPoint as Record<string, unknown>;
      if (!isRatio(point.x) || !isRatio(point.y)) return [];
      if (point.pressure !== undefined && !isRatio(point.pressure)) return [];
      if (point.time !== undefined && (!Number.isInteger(point.time) || Number(point.time) < 1 || Number(point.time) > SIGNATURE_MAX_STROKE_DURATION_MS)) return [];
      stroke.push({
        x: point.x,
        y: point.y,
        ...(point.pressure === undefined ? {} : { pressure: point.pressure as number }),
        ...(point.time === undefined ? {} : { time: point.time as number }),
      });
    }
    strokes.push(stroke);
  }
  return strokes;
}

function isRatio(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= 1;
}

/**
 * 저장 직전 좌표를 소수 셋째 자리로 줄입니다. 1000px 폭에서 1픽셀 미만이라 더 담을 이유가 없고,
 * 서명 하나가 수백 점이라 자릿수를 줄이면 JSON 크기가 눈에 띄게 작아집니다.
 */
export function quantizeSignatureStrokes(strokes: SignatureStrokes): SignatureStrokes {
  return strokes.map((stroke) =>
    stroke.map((point) => ({
      x: Number(point.x.toFixed(3)),
      y: Number(point.y.toFixed(3)),
      ...(point.pressure === undefined ? {} : { pressure: Number(point.pressure.toFixed(3)) }),
      ...(point.time === undefined ? {} : { time: Math.round(point.time) }),
    })),
  );
}

type PadPoint = { x: number; y: number; pressure: number; time: number };
type PadPointGroup = { points: PadPoint[] };

/** signature_pad의 CSS 픽셀 좌표를 저장용 0~1 좌표로 바꿉니다. */
export function signaturePadDataToStrokes(groups: readonly PadPointGroup[], width: number, height: number): SignatureStrokes {
  if (!(width > 0) || !(height > 0)) return [];
  return quantizeSignatureStrokes(groups
    .slice(0, SIGNATURE_MAX_STROKES)
    .flatMap((group) => {
      const valid = group.points.filter((point) => Number.isFinite(point.x) && Number.isFinite(point.y));
      if (!valid.length) return [];
      const startedAt = Number.isFinite(valid[0].time) ? valid[0].time : 0;
      const points = valid.slice(0, SIGNATURE_MAX_POINTS_PER_STROKE).map((point, index) => {
        const pressure = Number.isFinite(point.pressure) ? Math.min(1, Math.max(0, point.pressure)) : 0;
        const elapsed = Number.isFinite(point.time) ? point.time - startedAt + 1 : index * 16 + 1;
        return {
          x: Math.min(1, Math.max(0, point.x / width)),
          y: Math.min(1, Math.max(0, point.y / height)),
          ...(pressure > 0 ? { pressure } : {}),
          time: Math.min(SIGNATURE_MAX_STROKE_DURATION_MS, Math.max(1, Math.round(elapsed))),
        };
      });
      return [points];
    }));
}

/** 저장 좌표를 signature_pad가 다시 그릴 수 있는 CSS 픽셀 좌표로 복원합니다. */
export function signatureStrokesToPadPoints(strokes: SignatureStrokes, width: number, height: number): PadPointGroup[] {
  return strokes.map((stroke) => ({
    points: stroke.map((point, index) => ({
      x: point.x * width,
      y: point.y * height,
      pressure: point.pressure ?? 0,
      // Point 생성자는 0을 현재 시각으로 치환하므로 항상 1 이상이어야 합니다.
      time: point.time ?? index * 16 + 1,
    })),
  }));
}

/**
 * 그리는 동안 쌓인 점을 최소 간격으로 솎아냅니다. 포인터 이벤트는 1초에 수백 번 오는데 그걸
 * 그대로 담으면 획 하나가 상한(2000점)을 넘고, 화면에 보이는 곡선은 달라지지 않습니다.
 *
 * 상한을 넘으면 앞에서 자르지 않고 전체에서 고르게 뽑습니다 — 앞부분만 남기면 천천히 그은 획이
 * 중간에서 뚝 끊깁니다(simplifyPolygon과 같은 이유).
 */
export function simplifySignatureStroke(points: SignaturePoint[], minDistance = 0.004): SignaturePoint[] {
  const thinned: SignaturePoint[] = [];
  for (const point of points) {
    const last = thinned[thinned.length - 1];
    if (!last || Math.hypot(point.x - last.x, point.y - last.y) >= minDistance) thinned.push(point);
  }
  if (thinned.length <= SIGNATURE_MAX_POINTS_PER_STROKE) return thinned;

  const step = (thinned.length - 1) / (SIGNATURE_MAX_POINTS_PER_STROKE - 1);
  return Array.from({ length: SIGNATURE_MAX_POINTS_PER_STROKE }, (_, index) => thinned[Math.round(index * step)]);
}

/**
 * 획 하나를 SVG path의 `d` 문자열로 바꿉니다. 좌표가 0~1이므로 호출자가 실제 크기를 곱해 줍니다
 * (또는 `viewBox="0 0 1 1"`에 그대로 넣습니다).
 *
 * 곡선 보간 없이 직선으로 잇습니다. 점이 이미 촘촘해서 육안으로는 곡선과 구별되지 않고,
 * 보간을 넣으면 화면(캔버스)과 인쇄(SVG)의 모양이 미세하게 달라집니다.
 */
export function strokeToSvgPath(stroke: SignatureStroke, width = 1, height = 1): string {
  return stroke
    .map((point, index) => `${index === 0 ? "M" : "L"}${round(point.x * width)} ${round(point.y * height)}`)
    .join(" ");
}

/** 획 전부를 path 하나로 잇습니다. 각 획이 M으로 시작하므로 서로 연결되지 않습니다. */
export function strokesToSvgPath(strokes: SignatureStrokes, width = 1, height = 1): string {
  return strokes.map((stroke) => strokeToSvgPath(stroke, width, height)).join(" ");
}

function round(value: number) {
  return Math.round(value * 1000) / 1000;
}

/** 서명이 실제로 그려졌는지. 필수 필드 검사와 "지우기" 버튼 활성화에 함께 씁니다. */
export function hasSignature(value: unknown): boolean {
  return parseSignatureStrokes(value).length > 0;
}
