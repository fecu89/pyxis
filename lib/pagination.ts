export type PageNumberItem = number | "ellipsis";

/**
 * 목록 페이지네이션에 표시할 번호를 만듭니다. 처음·끝 페이지는 항상 남기고, 현재 페이지
 * 주변은 직접 건너뛸 수 있게 보여 줍니다. blog 프로젝트의 번호형 페이지네이션 규칙을
 * pyxis의 서버 렌더 목록에서도 함께 쓸 수 있도록 순수 함수로 분리했습니다.
 */
export function getPageNumbers(currentPage: number, totalPages: number): PageNumberItem[] {
  const total = Math.max(1, Math.floor(totalPages));
  const current = Math.min(total, Math.max(1, Math.floor(currentPage)));

  if (total <= 7) return Array.from({ length: total }, (_, index) => index + 1);
  if (current <= 4) return [1, 2, 3, 4, 5, "ellipsis", total];
  if (current >= total - 3) return [1, "ellipsis", total - 4, total - 3, total - 2, total - 1, total];
  return [1, "ellipsis", current - 1, current, current + 1, "ellipsis", total];
}
