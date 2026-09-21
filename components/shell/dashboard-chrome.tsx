import "server-only";

import type { ReactNode } from "react";
import type { CurrentUser } from "@/lib/auth/current-user";
import { canAccessAdminShell } from "@/lib/auth/authorization";
import { TopNav } from "@/components/shell/top-nav";
import { DASHBOARD_PATH, navSectionViewsByTopSection, topSectionViewsFor } from "@/lib/routes";
import { NotificationBell } from "@/components/notifications/notification-bell";
import { AppShell } from "@/components/shell/app-shell";
import { Brand } from "@/components/home/home-shell";
import { NavCountsProvider } from "@/components/shell/nav-counts";

// app/(dashboard)/layout.tsx가 로그인 사용자에게만 그리는 상주 셸입니다. 라우트가 바뀌어도
// (/dashboard, /pad, /profile 등) 이 컴포넌트는 다시 마운트되지 않으므로
// 사이드바·알림벨 SSE가 페이지 전환 중에도 끊기지 않습니다. 모바일에서만 보이는 브랜드는
// .home-nav .brand에 있고(≥960px에서는 사이드바 브랜드와 겹쳐 CSS로 숨김), 데스크탑 사이드바는
// AppShell이 그립니다.
export function DashboardChrome({
  user,
  initialNotifications,
  children,
}: {
  user: CurrentUser;
  initialNotifications: Parameters<typeof NotificationBell>[0]["initialData"];
  children: ReactNode;
}) {
  const canAccessAdmin = canAccessAdminShell(user);
  // 메뉴 구성과 권한 필터는 여기(서버)서 끝내고, 셸에는 그릴 것만 평범한 데이터로 넘깁니다.
  // 그래야 라우트 매니페스트가 클라이언트 번들에 실리지 않습니다(lib/nav-view.ts 주석 참고).
  const topSections = topSectionViewsFor(user);
  const navSectionsByTop = navSectionViewsByTopSection(user);

  // 최상위 섹션 전환(navbar)은 사이드바보다 위에, 전체 폭으로 놓습니다. 사이드바는 그 아래에서
  // 선택된 섹션 안의 하위 라우팅만 그립니다.
  const content = (
    <div className="app-frame">
      <header className="home-nav">
        {/* 사이드바가 자체 헤딩(브랜드·닫기 버튼)을 갖고 있던 시절의 블록이 이 헤더에 남아 있었는데,
            그 안의 onClick이 사이드바의 setOpen을 참조해서 서버 컴포넌트인 이 파일에서는 정의조차
            되지 않은 함수였습니다 — 서버가 클라이언트로 함수를 직렬화하려다 /dashboard 전체가
            500으로 떨어졌습니다. 헤더의 브랜드는 바로 아래 <Brand />가, 드로어 닫기는 사이드바가
            각자 그리므로 중복이기도 해서 통째로 걷어냅니다. */}
        <Brand href={DASHBOARD_PATH} />
        <TopNav sections={topSections} />
        {/* 이 막대는 **섹션 전환**이 하는 일의 전부입니다. 예전에는 여기에 "새 패드" 버튼이
            있었는데, 퀴즈·리포트·교과목 화면에서도 패드 전용 액션이 따라다녀서 이 줄이 무엇을
            하는 곳인지 흐려졌습니다. 패드 만들기는 /pad 안에 헤더 버튼·그리드 타일·빈 상태
            CTA 세 군데가 이미 있으므로 여기서 빼도 잃는 경로가 없습니다. */}
        <div className="nav-actions">
          <NotificationBell initialData={initialNotifications} />
        </div>
      </header>
      <AppShell topSections={topSections} navSectionsByTop={navSectionsByTop} user={user} canAccessAdmin={canAccessAdmin}>
        {children}
      </AppShell>
    </div>
  );
  // 사이드바와 그 아래 화면이 모두 안에 들어와야 개수 배지가 전달됩니다.
  return <NavCountsProvider>{content}</NavCountsProvider>;
}
