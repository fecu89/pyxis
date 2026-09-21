// `import type`은 컴파일 단계에서 완전히 지워지므로 이 줄로는 매니페스트가 번들에 들어오지
// 않습니다(nav-icons.tsx도 같은 방식으로 아이콘 키만 가져옵니다). **값**을 import하면
// 그 순간 라우트 표 전체가 딸려 오므로 절대 바꾸지 마세요.
import type { NavIconKey } from "@/lib/routes";

/**
 * 셸(상단바·사이드바)이 **그리기 위해서만** 필요한 최소 데이터와 그 위의 순수 함수입니다.
 *
 * 왜 `lib/routes.ts`와 갈라 놨는가 — 활성 항목 표시는 클라이언트에서 해야 합니다. App Router는
 * 라우트를 옮길 때 `page.tsx`만 갱신하고 `(workspace)/layout.tsx`는 다시 렌더링하지 않아서(그
 * 덕분에 사이드바와 알림 SSE가 안 끊깁니다), 서버가 계산한 "지금 활성"은 이동 직후 낡습니다.
 * 그래서 `usePathname()`이 필요합니다.
 *
 * 그런데 셸이 `lib/routes.ts`에서 함수 하나만 import해도 **라우트 표 47개가 통째로** 클라이언트
 * 번들에 실립니다(그 함수들이 매니페스트를 참조하므로 트리셰이킹으로 지워지지 않습니다).
 * 실제로 그 상태에서 서버·클라이언트가 서로 다른 버전의 매니페스트를 들고 hydration 불일치가
 * 났습니다. 이제 서버가 **보이는 항목만** 평범한 데이터로 만들어 내려보내고, 클라이언트는
 * 이 파일의 순수 함수로 활성만 계산합니다 — 클라이언트에 매니페스트가 아예 없으니 두 쪽이
 * 어긋날 수가 없습니다.
 *
 * 이 파일은 매니페스트를 import하지 않습니다. 그 규칙이 깨지면 위 보장도 함께 깨집니다.
 */

export type { NavIconKey };

export type NavItemView = {
  readonly id: string;
  /** 서버가 이미 만들어 둔 최종 링크. 클라이언트는 경로를 조립하지 않습니다. */
  readonly href: string;
  readonly label: string;
  readonly icon: NavIconKey;
  /** 개수 배지 키. 화면이 아직 집계를 올리지 않았으면 배지를 그리지 않습니다. */
  readonly countKey?: string;
  /** 아래 활성 판정에만 쓰는 값들 */
  readonly path: string;
  readonly match: "exact" | "prefix";
};

export type NavGroupView = {
  readonly item: NavItemView;
  readonly children: readonly NavItemView[];
};

export type NavSectionView = {
  readonly key: string;
  readonly label: string | null;
  readonly groups: readonly NavGroupView[];
};

export type TopSectionView = {
  readonly key: string;
  readonly label: string;
  readonly href: string;
  readonly icon: NavIconKey;
  /** 이 접두사 중 하나로 시작하면 활성입니다. */
  readonly prefixes: readonly string[];
};

/** 항목 하나가 지금 열려 있는 화면인지. `lib/routes.ts`의 `isActive`와 같은 규칙입니다. */
export function isNavItemActive(item: NavItemView, pathname: string): boolean {
  const pathMatches = item.match === "prefix"
    ? pathname === item.path || pathname.startsWith(`${item.path}/`)
    : pathname === item.path;
  return pathMatches;
}

/** 지금 경로가 속한 최상위 섹션. 가장 긴 접두사가 이깁니다. */
export function activeTopSectionKey(sections: readonly TopSectionView[], pathname: string): string | null {
  return sections
    .flatMap((section) => section.prefixes.map((prefix) => ({ section, prefix })))
    .filter(({ prefix }) => pathname === prefix || pathname.startsWith(`${prefix}/`))
    .sort((left, right) => right.prefix.length - left.prefix.length)[0]?.section.key ?? null;
}
