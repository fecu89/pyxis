// 이미지 위에 꽂는 핀의 좌표계 — 핀 고정형(PIN_ANCHOR)과 드롭 핀(DROP_PIN)이 함께 씁니다.
// 참여 코드인 세션 PIN(lib/quiz/session-pin.ts)과는 전혀 다른 것이라 이름을 갈라 두었습니다.
//
// 모든 값은 이미지 좌상단을 (0,0), 우하단을 (1,1)로 두는 정규화 좌표입니다. 원본 픽셀을 저장하면
// 학생 화면 크기·이미지 축소에 따라 판정이 달라지므로, 저장·판정·표시가 전부 이 비율 좌표만 씁니다.
//
// 원도 반지름 하나가 아니라 가로·세로 반지름(radiusX·radiusY)을 따로 저장합니다. 반지름 하나만
// 두면 정규화 좌표에서 타원이 되어 버려서 "이미지 비율"을 함께 알아야 원래 원으로 되돌릴 수
// 있는데, 그 비율을 학생 클라이언트가 보내면 값을 조작해 판정 범위를 늘릴 수 있습니다. 두 축을
// 저장해 두면 채점이 저장된 값만으로 끝나 클라이언트 입력에 의존하지 않습니다.

export type PinPoint = { x: number; y: number };
export type PinArea =
  | { shape: "RECT"; x: number; y: number; width: number; height: number }
  | { shape: "CIRCLE"; x: number; y: number; radiusX: number; radiusY: number }
  | { shape: "POLYGON"; points: PinPoint[] };

/** 편집기 요약에서도 쓸 수 있는 순수 라벨. 이미지 렌더러 청크를 끌어오지 않습니다. */
export function pinAreaLabel(area: PinArea) {
  return area.shape === "RECT" ? "직사각형" : area.shape === "CIRCLE" ? "원형" : `자유형 (${area.points.length}점)`;
}

/** DB의 Json 컬럼은 무엇이든 들어올 수 있으므로 읽을 때마다 검증합니다. 깨진 값은 빈 배열로 처리합니다. */
export function parsePinAreas(value: unknown): PinArea[] {
  if (!Array.isArray(value) || value.length > 10) return [];
  const areas: PinArea[] = [];
  for (const raw of value) {
    if (!raw || typeof raw !== "object") return [];
    const area = raw as Record<string, unknown>;
    if (area.shape === "RECT" && isRatio(area.x) && isRatio(area.y) && isRatio(area.width) && isRatio(area.height)) {
      areas.push({ shape: "RECT", x: area.x, y: area.y, width: area.width, height: area.height });
      continue;
    }
    if (area.shape === "CIRCLE" && isRatio(area.x) && isRatio(area.y) && isRadius(area.radiusX) && isRadius(area.radiusY)) {
      areas.push({ shape: "CIRCLE", x: area.x, y: area.y, radiusX: area.radiusX, radiusY: area.radiusY });
      continue;
    }
    if (area.shape === "POLYGON" && Array.isArray(area.points) && area.points.length >= 3 && area.points.length <= POLYGON_MAX_POINTS) {
      const points = area.points.flatMap((point) => isPinPoint(point) ? [point] : []);
      if (points.length !== area.points.length) return [];
      areas.push({ shape: "POLYGON", points });
      continue;
    }
    return [];
  }
  return areas;
}

/** 학생이 제출한 좌표는 textResponse에 JSON으로 담깁니다. 형식이 어긋나면 null입니다. */
export function parsePinPoint(value: string | null | undefined): PinPoint | null {
  if (!value) return null;
  try {
    const parsed: unknown = JSON.parse(value);
    return isPinPoint(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

export function serializePinPoint(point: PinPoint) {
  // 소수점 넷째 자리면 4000px 이미지에서도 1픽셀 미만이라 더 담을 이유가 없습니다.
  return JSON.stringify({ x: Number(point.x.toFixed(4)), y: Number(point.y.toFixed(4)) });
}

/**
 * 다각형 내부 판정(ray casting). 변 위에 정확히 놓인 점은 부동소수 오차로 어느 쪽이든 나올 수
 * 있는데, 학생이 경계를 노리고 찍는 경우는 사실상 없어 별도 보정을 두지 않습니다.
 */
function isInsidePolygon(point: PinPoint, points: PinPoint[]) {
  let inside = false;
  for (let index = 0, previous = points.length - 1; index < points.length; previous = index, index += 1) {
    const current = points[index];
    const last = points[previous];
    const straddles = current.y > point.y !== last.y > point.y;
    if (!straddles) continue;
    const crossingX = ((last.x - current.x) * (point.y - current.y)) / (last.y - current.y) + current.x;
    if (point.x < crossingX) inside = !inside;
  }
  return inside;
}

/**
 * 정규화 좌표에서의 타원 내부 판정. 두 반지름이 이미 x·y 각 축의 비율이라 추가 보정이 없습니다.
 * SVG로 그리는 모양(components/image-pin.tsx)과 같은 식이라 화면과 판정이 어긋나지 않습니다.
 */
function isInsideCircle(point: PinPoint, area: Extract<PinArea, { shape: "CIRCLE" }>) {
  const dx = (point.x - area.x) / Math.max(area.radiusX, Number.EPSILON);
  const dy = (point.y - area.y) / Math.max(area.radiusY, Number.EPSILON);
  return dx * dx + dy * dy <= 1;
}

export function isPinInsideArea(point: PinPoint, area: PinArea) {
  if (area.shape === "RECT") {
    return point.x >= area.x && point.x <= area.x + area.width && point.y >= area.y && point.y <= area.y + area.height;
  }
  if (area.shape === "CIRCLE") return isInsideCircle(point, area);
  return isInsidePolygon(point, area.points);
}

/** 정답 영역이 여러 개면 하나라도 들어가면 정답입니다. 영역이 없으면 채점할 수 없어 항상 오답입니다. */
export function isPinCorrect(point: PinPoint | null, areas: PinArea[]) {
  if (!point || !areas.length) return false;
  return areas.some((area) => isPinInsideArea(point, area));
}

export const POLYGON_MAX_POINTS = 60;

function isRatio(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= 1;
}

function isRadius(value: unknown): value is number {
  return isRatio(value) && value >= 0.002;
}

function isPinPoint(value: unknown): value is PinPoint {
  if (!value || typeof value !== "object") return false;
  const point = value as Record<string, unknown>;
  return isRatio(point.x) && isRatio(point.y);
}

/**
 * 편집기에서 자유형을 그릴 때 꼭짓점이 너무 촘촘해지지 않도록 최소 간격으로 솎아냅니다.
 *
 * 그래도 상한을 넘으면 앞에서 자르지 않고 전체에서 고르게 뽑습니다 — 앞부분만 남기면 천천히
 * 그린 사람의 영역이 중간에 뚝 끊긴 채 닫혀서, 그린 모양과 전혀 다른 도형이 저장됩니다.
 */
export function simplifyPolygon(points: PinPoint[], minDistance = 0.012): PinPoint[] {
  const thinned: PinPoint[] = [];
  for (const point of points) {
    const last = thinned[thinned.length - 1];
    if (!last || Math.hypot(point.x - last.x, point.y - last.y) >= minDistance) thinned.push(point);
  }
  if (thinned.length <= POLYGON_MAX_POINTS) return thinned;

  const step = (thinned.length - 1) / (POLYGON_MAX_POINTS - 1);
  return Array.from({ length: POLYGON_MAX_POINTS }, (_, index) => thinned[Math.round(index * step)]);
}
