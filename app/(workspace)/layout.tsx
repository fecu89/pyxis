import { Suspense, type ReactNode } from "react";
import { getCurrentUser } from "@/lib/auth/current-user";
import { DashboardChrome } from "@/components/shell/dashboard-chrome";
import { DashboardLoading } from "@/components/shell/dashboard-loading";
import { getNotificationSummary } from "@/lib/notifications/list";

export const dynamic = "force-dynamic";

// /dashboard, /pad/*, /quiz/*, /forms/*, /report/*, /profile 라우트가 공유하는 레이아웃입니다. Next.js는 라우트 이동 시 바뀐
// page.tsx 세그먼트만 다시 렌더링하고 이 layout은 그대로 유지하므로, 사이드바·상단바·알림벨 SSE가
// 페이지 전환 중에 끊기지 않습니다(이전에는 각 페이지가 독립적으로 AppShell을 그려서 라우트를
// 옮길 때마다 사이드바까지 통째로 다시 마운트됐습니다). 비로그인 사용자에게는 셸을 아예 그리지
// 않고 children(각 페이지의 로그인 리다이렉트)만 그대로 반환합니다.
//
// 이 공용 레이아웃에서는 패드·교과목 목록을 읽지 않습니다. 그런 데이터를 여기서 읽으면 설문이나
// 퀴즈에 들어갈 때도 패드 홈 전체 쿼리를 기다려야 하므로 각 기능의 page.tsx로 범위를 좁힙니다.
export default async function DashboardLayout({ children }: { children: ReactNode }) {
  const user = await getCurrentUser();
  if (!user) return <>{children}</>;

  const notifications = await getNotificationSummary(user.id);
  return (
    <DashboardChrome user={user} initialNotifications={notifications}>
      <Suspense fallback={<DashboardLoading />}>{children}</Suspense>
    </DashboardChrome>
  );
}
