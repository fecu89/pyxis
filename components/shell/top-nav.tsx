"use client";

import { useEffect, useRef } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { NAV_ICONS } from "@/components/shell/nav-icons";
import { activeTopSectionKey, type TopSectionView } from "@/lib/nav-view";

// 최상위 섹션 전환 막대입니다. 사이드바는 **선택된 섹션 안에서만** 하위 라우팅을 그리므로,
// 이 두 층이 합쳐져야 "지금 어디에 있는가"가 드러납니다.
//
// 항목 자체는 서버가 만들어 내려보냅니다(`topSectionViewsFor`). 예전에는 여기서 매니페스트를
// 직접 읽었는데, 그러면 라우트 표 47개가 클라이언트 번들에 실리고 서버·클라이언트가 서로 다른
// 버전을 들게 되면 hydration 불일치가 납니다(실제로 겪었습니다 — 서버는 /courses를 그리는데
// 클라이언트는 /quiz를 그렸습니다). 이제 클라이언트가 하는 일은 활성 판정뿐입니다.
//
// 활성 판정만 클라이언트에 남는 이유: App Router는 라우트를 옮길 때 page.tsx만 갱신하고
// 이 컴포넌트를 감싼 레이아웃은 다시 렌더링하지 않아서, 서버가 계산한 값은 이동 직후 낡습니다.
export function TopNav({ sections }: { sections: readonly TopSectionView[] }) {
  const pathname = usePathname();
  const active = activeTopSectionKey(sections, pathname);
  const navRef = useRef<HTMLElement>(null);

  useEffect(() => {
    if (!window.matchMedia("(max-width: 860px)").matches) return;
    navRef.current?.querySelector<HTMLElement>("[aria-current='page']")
      ?.scrollIntoView({ behavior: "smooth", block: "nearest", inline: "center" });
  }, [active]);

  return (
    <nav ref={navRef} className="top-nav" aria-label="주요 영역">
      {sections.map((section) => {
        const Icon = NAV_ICONS[section.icon];
        return (
          <Link
            key={section.key}
            href={section.href}
            prefetch={false}
            className={`top-nav-link${active === section.key ? " active" : ""}`}
            aria-current={active === section.key ? "page" : undefined}
          >
            <Icon size={16} aria-hidden />
            <span>{section.label}</span>
          </Link>
        );
      })}
    </nav>
  );
}
