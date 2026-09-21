import { Suspense, type ReactNode } from "react";

/** 보관함 하위 보기 사이에서 작업공간 셸을 유지하고 목록 스트리밍만 교체하는 경계입니다. */
export default function QuizLibraryLayout({ children }: { children: ReactNode }) {
  return (
    <Suspense fallback={<main className="mx-auto w-full max-w-[1220px] flex-1 px-4 py-7 sm:px-6" aria-busy="true"><div className="h-40 animate-pulse rounded-3xl bg-surface-muted" /></main>}>
      {children}
    </Suspense>
  );
}
