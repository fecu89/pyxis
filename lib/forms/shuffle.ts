/** 원본 배열을 건드리지 않는 Fisher-Yates 셔플. random 주입은 편향 없이 동작하는지 검증할 때 씁니다. */
export function shuffledCopy<T>(items: readonly T[], enabled: boolean, random: () => number = Math.random): T[] {
  const result = [...items];
  if (!enabled) return result;
  for (let index = result.length - 1; index > 0; index -= 1) {
    const swapWith = Math.floor(random() * (index + 1));
    [result[index], result[swapWith]] = [result[swapWith], result[index]];
  }
  return result;
}
