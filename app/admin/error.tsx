"use client";

import { useRouter } from "next/navigation";
import { DASHBOARD_PATH } from "@/lib/route-paths";

export default function AdminError({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  const router = useRouter();

  function goBack() {
    if (window.history.length > 1) router.back();
    else router.push(DASHBOARD_PATH);
  }

  return (
    <main className="empty-page">
      <span className="empty-illustration" aria-hidden>!</span>
      <h1>관리자 정보를 불러오지 못했습니다</h1>
      <p>권한 또는 데이터베이스 연결을 다시 확인해 주세요.</p>
      <div className="access-actions"><button type="button" className="button primary" onClick={reset}>다시 시도</button><button type="button" className="button ghost" onClick={goBack}>이전으로</button></div>
    </main>
  );
}
