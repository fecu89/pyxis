import { LoaderCircle } from "lucide-react";

export function DashboardLoading() {
  return (
    <main className="dashboard-loading" aria-live="polite" aria-busy="true">
      <LoaderCircle className="spin" size={22} aria-hidden />
      <p>목록을 불러오는 중...</p>
    </main>
  );
}
