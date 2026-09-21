"use client";

import { useEffect, useRef, useTransition } from "react";
import { useRouter } from "next/navigation";

/** 열린 라이브가 뒤늦게 생겨도 대시보드/퀴즈 목록에서 발견합니다. 숨긴 탭은 갱신하지 않습니다. */
export function LearningAutoRefresh() {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const lastRefresh = useRef(0);
  useEffect(() => {
    const refresh = () => {
      if (document.visibilityState !== "visible" || pending || Date.now() - lastRefresh.current < 5000) return;
      lastRefresh.current = Date.now();
      startTransition(() => router.refresh());
    };
    const timer = window.setInterval(refresh, 15000);
    window.addEventListener("focus", refresh);
    document.addEventListener("visibilitychange", refresh);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener("focus", refresh);
      document.removeEventListener("visibilitychange", refresh);
    };
  }, [pending, router]);
  return null;
}
