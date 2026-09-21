import Link from "next/link";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { getPageNumbers } from "@/lib/pagination";

type PageNumberNavigationProps = {
  basePath: string;
  page: number;
  totalPages: number;
  totalCount?: number;
  params?: Record<string, string | undefined>;
};

function pageHref(basePath: string, page: number, params: Record<string, string | undefined>) {
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (key === "page") continue;
    if (value) query.set(key, value);
  }
  if (page > 1) query.set("page", String(page));
  const serialized = query.toString();
  return serialized ? `${basePath}?${serialized}` : basePath;
}

const navItemClass = "inline-flex min-h-11 min-w-11 shrink-0 items-center justify-center rounded-xl px-3 text-sm font-black transition";

/** blog 프로젝트처럼 이전·다음뿐 아니라 여러 페이지를 바로 건너뛸 수 있는 번호형 탐색입니다. */
export function PageNumberNavigation({ basePath, page, totalPages, totalCount, params = {} }: PageNumberNavigationProps) {
  if (totalPages <= 1) return null;
  const currentPage = Math.min(totalPages, Math.max(1, page));
  const pages = getPageNumbers(currentPage, totalPages);

  return (
    <nav className="mt-6 flex max-w-full items-center justify-start gap-1 overflow-x-auto pb-1 sm:justify-center sm:gap-2" aria-label="페이지 탐색">
      {totalCount !== undefined ? <span className="sr-only">전체 {totalCount}개</span> : null}
      {currentPage > 1 ? (
        <Link
          prefetch={false}
          className={`${navItemClass} text-content-muted hover:bg-surface-hover hover:text-content`}
          href={pageHref(basePath, currentPage - 1, params)}
          aria-label="이전 페이지"
        >
          <ChevronLeft className="h-5 w-5" aria-hidden />
        </Link>
      ) : (
        <button type="button" disabled className={`${navItemClass} cursor-not-allowed text-content-subtle opacity-45`} aria-label="이전 페이지">
          <ChevronLeft className="h-5 w-5" aria-hidden />
        </button>
      )}

      {pages.map((item, index) => item === "ellipsis" ? (
        <span key={`ellipsis-${index}`} className="inline-flex min-h-11 min-w-8 shrink-0 items-center justify-center text-content-subtle" aria-hidden>…</span>
      ) : item === currentPage ? (
        <span
          key={item}
          className={`${navItemClass} bg-brand text-on-brand shadow-sm`}
          aria-current="page"
          aria-label={`${item}페이지, 현재 페이지`}
        >
          {item}
        </span>
      ) : (
        <Link
          key={item}
          prefetch={false}
          className={`${navItemClass} text-content-muted hover:bg-surface-hover hover:text-content`}
          href={pageHref(basePath, item, params)}
          aria-label={`${item}페이지`}
        >
          {item}
        </Link>
      ))}

      {currentPage < totalPages ? (
        <Link
          prefetch={false}
          className={`${navItemClass} text-content-muted hover:bg-surface-hover hover:text-content`}
          href={pageHref(basePath, currentPage + 1, params)}
          aria-label="다음 페이지"
        >
          <ChevronRight className="h-5 w-5" aria-hidden />
        </Link>
      ) : (
        <button type="button" disabled className={`${navItemClass} cursor-not-allowed text-content-subtle opacity-45`} aria-label="다음 페이지">
          <ChevronRight className="h-5 w-5" aria-hidden />
        </button>
      )}
    </nav>
  );
}
