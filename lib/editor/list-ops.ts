// 편집기가 목록을 다룰 때 쓰는 순수 함수들. 퀴즈 편집기와 설문 편집기가 함께 씁니다.
//
// 별것 아닌 splice지만 두 편집기가 각자 인라인으로 쓰면 "복제는 뒤에, 삽입도 뒤에, 삭제 후
// 선택은 앞으로" 같은 규칙이 조금씩 어긋납니다. 실제로 퀴즈에서 `insertAfter`와
// `duplicate`가 같은 자리 계산을 따로 하고 있었습니다.
//
// 전부 새 배열을 돌려주고 원본을 건드리지 않습니다 — React 상태로 그대로 넣기 위해서입니다.

/** `from`의 항목을 빼서 `to` 자리에 넣습니다. 범위를 벗어나면 원본을 그대로 돌려줍니다. */
export function moveItem<T>(items: readonly T[], from: number, to: number): T[] {
  if (from === to || from < 0 || from >= items.length || to < 0 || to >= items.length) return [...items];
  const next = [...items];
  const [moved] = next.splice(from, 1);
  next.splice(to, 0, moved);
  return next;
}

/** `index` **바로 뒤**에 끼워 넣습니다. `index`가 -1이면 맨 앞입니다. */
export function insertAfter<T>(items: readonly T[], index: number, item: T): T[] {
  const next = [...items];
  next.splice(Math.max(0, Math.min(index + 1, next.length)), 0, item);
  return next;
}

export function removeAt<T>(items: readonly T[], index: number): T[] {
  return items.filter((_, itemIndex) => itemIndex !== index);
}

export function replaceAt<T>(items: readonly T[], index: number, updater: (item: T) => T): T[] {
  return items.map((item, itemIndex) => (itemIndex === index ? updater(item) : item));
}

/**
 * 항목을 지운 뒤 선택이 어디로 가야 하는지.
 *
 * 지운 것보다 뒤를 보고 있었다면 한 칸 당겨야 같은 항목을 계속 보게 되고, 마지막을 지웠다면
 * 새 마지막으로 물러나야 합니다. 이 계산을 화면마다 손으로 쓰면 목록 끝에서 빈 곳을 가리키는
 * 버그가 생깁니다.
 */
export function selectionAfterRemoval(selected: number, removed: number, nextLength: number): number {
  const shifted = selected > removed ? selected - 1 : selected;
  return Math.max(0, Math.min(shifted, nextLength - 1));
}
