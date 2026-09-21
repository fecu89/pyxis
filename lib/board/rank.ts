export const POSITION_GAP = 1024;

export function positionBetween(previous: number | null, next: number | null) {
  if (previous === null && next === null) return POSITION_GAP;
  if (previous === null) return next! - POSITION_GAP;
  if (next === null) return previous + POSITION_GAP;
  if (next - previous <= 1) return null;
  return Math.floor((previous + next) / 2);
}

/**
 * 요청을 만든 뒤 목록이 바뀌어도 현재 배열에서 실제로 인접한 삽입 이웃을 다시 찾습니다.
 * 앞 앵커를 우선하고, 사라졌으면 뒤 앵커, 둘 다 없으면 현재 목록 끝을 사용합니다.
 */
export function adjacentInsertionNeighbors<T extends { id: string }>(
  items: T[],
  previousItemId: string | null | undefined,
  nextItemId: string | null | undefined,
) {
  const previousIndex = previousItemId ? items.findIndex((item) => item.id === previousItemId) : -1;
  const nextIndex = nextItemId ? items.findIndex((item) => item.id === nextItemId) : -1;
  if (previousIndex >= 0) return { previous: items[previousIndex], next: items[previousIndex + 1] ?? null };
  if (nextIndex >= 0) return { previous: items[nextIndex - 1] ?? null, next: items[nextIndex] };
  return { previous: items.at(-1) ?? null, next: null };
}
