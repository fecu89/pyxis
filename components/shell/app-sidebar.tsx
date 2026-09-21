"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef, useState, type FormEvent, type ReactNode } from "react";
import { BookOpen, Clock3, FolderOpen, Menu, Plus } from "lucide-react";
import { NAV_ICONS } from "@/components/shell/nav-icons";
import { useNavCounts } from "@/components/shell/nav-counts";
import { activeTopSectionKey, isNavItemActive, type NavItemView, type NavSectionView, type TopSectionView } from "@/lib/nav-view";
import { SIDEBAR_DATA_CHANGED_EVENT, type SidebarDataChangedDetail } from "@/lib/sidebar-events";

// 패드 전용 동적 링크는 패드 섹션에 들어왔을 때 작은 API가 만들어 줍니다. 공용 레이아웃에서
// 패드 홈 전체를 읽지 않으므로 퀴즈·설문·리포트 진입은 이 데이터를 기다리지 않습니다.
export type SidebarRecentBoard = { id: string; slug: string; title: string; href: string };
export type SidebarFolder = { id: string; name: string; boardCount: number; href: string };
type PadSidebarData = { recentBoards: SidebarRecentBoard[]; folders: SidebarFolder[] };
type CourseSidebarData = { totalCount: number; courses: Array<{ id: string; name: string; href: string }> };
type RecentContentSidebarData = { items: Array<{ id: string; title: string; href: string }> };
type SidebarDataMap = {
  pad: PadSidebarData;
  dashboard: CourseSidebarData;
  quiz: RecentContentSidebarData;
  form: RecentContentSidebarData;
};

const EMPTY_PAD_SIDEBAR = { recentBoards: [], folders: [] } satisfies PadSidebarData;
const EMPTY_COURSE_SIDEBAR = { courses: [], totalCount: 0 } satisfies CourseSidebarData;
const EMPTY_RECENT_SIDEBAR = { items: [] } satisfies RecentContentSidebarData;

function applyPadSidebarChange(current: PadSidebarData | null, detail: SidebarDataChangedDetail) {
  if (!current || !detail.folder) return current;
  const changedFolder = detail.folder;
  if (changedFolder.removed) {
    return { ...current, folders: current.folders.filter((folder) => folder.id !== changedFolder.id) };
  }
  const changedName = changedFolder.name;
  if (changedName !== undefined) {
    return {
      ...current,
      folders: current.folders.map((folder) => folder.id === changedFolder.id
        ? { ...folder, name: changedName }
        : folder),
    };
  }
  return current;
}

function useSidebarData<Section extends keyof SidebarDataMap>(
  section: Section,
  active: boolean,
  emptyData: SidebarDataMap[Section],
  refreshOnChange = false,
  applyChange?: (current: SidebarDataMap[Section] | null, detail: SidebarDataChangedDetail) => SidebarDataMap[Section] | null,
  refreshKey?: string,
) {
  const [data, setData] = useState<SidebarDataMap[Section] | null>(null);
  const loadSeq = useRef(0);

  useEffect(() => {
    if (!active) return;
    const controller = new AbortController();
    const load = () => {
      const seq = ++loadSeq.current;
      void fetch(`/api/navigation/sidebar?section=${section}`, { cache: "no-store", signal: controller.signal })
        .then((response) => response.ok ? response.json() as Promise<SidebarDataMap[Section]> : Promise.resolve(emptyData))
        .then((result) => { if (seq === loadSeq.current) setData(result); })
        .catch((reason: unknown) => {
          if (seq === loadSeq.current && !(reason instanceof DOMException && reason.name === "AbortError")) setData(emptyData);
        });
    };
    const reloadChangedSection = (event: Event) => {
      const changed = event as CustomEvent<SidebarDataChangedDetail>;
      if (changed.detail?.section !== section) return;
      if (applyChange) setData((current) => applyChange(current, changed.detail));
      load();
    };
    load();
    if (refreshOnChange) window.addEventListener(SIDEBAR_DATA_CHANGED_EVENT, reloadChangedSection);
    return () => {
      controller.abort();
      if (refreshOnChange) window.removeEventListener(SIDEBAR_DATA_CHANGED_EVENT, reloadChangedSection);
    };
  }, [active, applyChange, emptyData, refreshKey, refreshOnChange, section]);

  return [data, setData, () => { loadSeq.current += 1; }] as const;
}

// 링크·라벨·아이콘 키는 서버가 만들어 내려보냅니다(`navSectionViewsFor`). 여기서는 그리기만 합니다.
function NavLink({ item, active, counts, sub = false, onNavigate }: {
  item: NavItemView;
  active: boolean;
  counts: Readonly<Record<string, number>>;
  sub?: boolean;
  onNavigate: () => void;
}) {
  const Icon = NAV_ICONS[item.icon];
  const countKey = item.countKey;
  // 아직 화면이 집계를 올리지 않았으면 배지를 그리지 않습니다. 0으로 대신 그리면 "없다"는
  // 거짓말이 됩니다.
  const count = countKey ? counts[countKey] : undefined;
  return (
    <Link
      href={item.href}
      prefetch={false}
      className={`${sub ? "app-sidebar-sublink" : "app-sidebar-link"}${active ? " active" : ""}`}
      aria-current={active ? "page" : undefined}
      onClick={onNavigate}
    >
      <Icon size={sub ? 15 : 17} aria-hidden />
      <span>{item.label}</span>
      {count !== undefined && <small>{count}</small>}
    </Link>
  );
}

function RecentSidebarSection({ title, emptyLabel, data, pathname, onNavigate }: {
  title: string;
  emptyLabel: string;
  data: RecentContentSidebarData | null;
  pathname: string;
  onNavigate: () => void;
}) {
  return (
    <div className="app-sidebar-section">
      <span className="app-sidebar-section-title"><Clock3 size={13} aria-hidden />{title}</span>
      {data === null
        ? <p className="app-sidebar-empty">불러오는 중…</p>
        : data.items.length > 0
          ? <div className="app-sidebar-list">{data.items.map((item) => {
              const active = pathname === item.href || pathname.startsWith(`${item.href}/`);
              return <Link key={item.id} href={item.href} prefetch={false} className={`app-sidebar-list-link${active ? " active" : ""}`} onClick={onNavigate}><span>{item.title}</span></Link>;
            })}</div>
          : <p className="app-sidebar-empty">{emptyLabel}</p>}
    </div>
  );
}
// 메뉴 구성(무엇이 보이는가)은 서버가 이미 끝냈으므로 여기에 역할·권한이 필요 없습니다.
// 계정 독에 쓰는 표시용 정보만 남습니다.
export type SidebarUser = { name: string | null; image: string | null; loginIdentifier: string };

export function AppSidebar({
  topSections,
  navSectionsByTop,
  accountDock,
}: {
  topSections: readonly TopSectionView[];
  navSectionsByTop: Readonly<Record<string, NavSectionView[]>>;
  accountDock: ReactNode;
}) {
  const pathname = usePathname();
  const navCounts = useNavCounts();
  const [open, setOpen] = useState(false);
  const [newFolderName, setNewFolderName] = useState("");
  const [creating, setCreating] = useState(false);

  // 무엇이 보이는지는 서버가 정했습니다(권한 필터 포함). 여기서는 "지금 어디인가"만 봅니다.
  const top = activeTopSectionKey(topSections, pathname);
  const sections = (top && navSectionsByTop[top]) || [];
  const showPadExtras = top === "pad";
  const showDashboardExtras = top === "dashboard";
  const showQuizExtras = top === "quiz";
  const showFormExtras = top === "form";
  const [padSidebar, setPadSidebar, invalidatePadSidebarRequest] = useSidebarData("pad", showPadExtras, EMPTY_PAD_SIDEBAR, true, applyPadSidebarChange, pathname);
  const [courseSidebar] = useSidebarData("dashboard", showDashboardExtras, EMPTY_COURSE_SIDEBAR, true);
  const [quizSidebar] = useSidebarData("quiz", showQuizExtras, EMPTY_RECENT_SIDEBAR, true, undefined, pathname);
  const [formSidebar] = useSidebarData("form", showFormExtras, EMPTY_RECENT_SIDEBAR, true, undefined, pathname);

  useEffect(() => {
    if (!open) return;
    const previousOverflow = document.body.style.overflow;
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    document.body.style.overflow = "hidden";
    window.addEventListener("keydown", closeOnEscape);
    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener("keydown", closeOnEscape);
    };
  }, [open]);

  async function createFolder(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const name = newFolderName.trim();
    if (!name) return;
    setCreating(true);
    try {
      const response = await fetch("/api/dashboard", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ name }),
      });
      if (!response.ok) return;
      const result = await response.json() as { folder?: { id: string; name: string } };
      // 마운트 직후 시작한 목록 응답이 새 폴더를 포함하지 않은 채 나중에 도착해 덮지 못하게 합니다.
      invalidatePadSidebarRequest();
      setNewFolderName("");
      if (result.folder) {
        const folder = result.folder;
        setPadSidebar((current) => ({
          recentBoards: current?.recentBoards ?? [],
          folders: [
            ...(current?.folders ?? []).filter((item) => item.id !== folder.id),
            { id: folder.id, name: folder.name, boardCount: 0, href: `/pad/folders/${encodeURIComponent(folder.id)}` },
          ],
        }));
      }
    } finally {
      setCreating(false);
    }
  }

  return (
    <>
      <button
        type="button"
        className="app-sidebar-trigger"
        aria-label="메뉴 열기"
        aria-controls="app-sidebar"
        aria-expanded={open}
        onClick={() => setOpen(true)}
      >
        <Menu size={22} aria-hidden />
      </button>
      <button
        type="button"
        className="app-sidebar-backdrop"
        data-open={open}
        aria-label="메뉴 닫기"
        aria-hidden={!open}
        tabIndex={open ? 0 : -1}
        onClick={() => setOpen(false)}
      />
      <aside
        id="app-sidebar"
        className="app-sidebar"
        data-open={open}
        aria-label="사이드바"
      >
        <div className="app-sidebar-scroll">
          {sections.map((section) => (
            <nav key={section.key} className="app-sidebar-nav" aria-label={section.label ?? "주요 메뉴"}>
              {section.label && <span className="app-sidebar-section-title">{section.label}</span>}
              {section.groups.map(({ item, children }) => {
                // 부모는 하위 항목 중 하나가 활성이어도 함께 강조합니다. 접힌 목록이 아니라
                // 항상 펼쳐 두므로, 부모만 꺼져 있으면 지금 어느 묶음에 있는지 읽히지 않습니다.
                const childActive = children.some((child) => isNavItemActive(child, pathname));
                return (
                  <div key={item.id} className="app-sidebar-group">
                    <NavLink item={item} active={isNavItemActive(item, pathname) || childActive} counts={navCounts} onNavigate={() => setOpen(false)} />
                    {children.length > 0 && (
                      <div className="app-sidebar-subnav">
                        {children.map((child) => (
                          <NavLink key={child.id} item={child} sub active={isNavItemActive(child, pathname)} counts={navCounts} onNavigate={() => setOpen(false)} />
                        ))}
                      </div>
                    )}
                  </div>
                );
              })}
            </nav>
          ))}

          {showDashboardExtras && <div className="app-sidebar-section">
            <span className="app-sidebar-section-title"><BookOpen size={13} aria-hidden />교과목 바로가기</span>
            {courseSidebar === null
              ? <p className="app-sidebar-empty">불러오는 중…</p>
              : courseSidebar.courses.length > 0
              ? <div className="app-sidebar-list">
                  {courseSidebar.courses.map((course) => (
                    <Link
                      key={course.id}
                      href={course.href}
                      prefetch={false}
                      className={`app-sidebar-list-link${pathname === course.href ? " active" : ""}`}
                      onClick={() => setOpen(false)}
                    >
                      <span>{course.name}</span>
                    </Link>
                  ))}
                  {courseSidebar.totalCount > courseSidebar.courses.length
                    ? <p className="app-sidebar-empty">나머지 {courseSidebar.totalCount - courseSidebar.courses.length}개는 교과목 목록에서 확인할 수 있습니다.</p>
                    : null}
                </div>
              : <p className="app-sidebar-empty">아직 교과목이 없습니다.</p>}
          </div>}

          {showPadExtras && <div className="app-sidebar-section">
            <span className="app-sidebar-section-title"><FolderOpen size={13} aria-hidden />내 폴더</span>
            <div className="app-sidebar-list">
              {(padSidebar?.folders ?? []).map((folder) => (
                <Link
                  key={folder.id}
                  href={folder.href}
                  prefetch={false}
                  className={`app-sidebar-list-link${pathname === folder.href ? " active" : ""}`}
                  onClick={() => setOpen(false)}
                >
                  <span>{folder.name}</span>
                  <small>{folder.boardCount}</small>
                </Link>
              ))}
            </div>
            <form className="app-sidebar-folder-create" onSubmit={createFolder}>
              <label>
                <span className="app-sidebar-visually-hidden">새 폴더 이름</span>
                <input value={newFolderName} maxLength={60} placeholder="새 폴더" onChange={(event) => setNewFolderName(event.target.value)} />
              </label>
              <button type="submit" aria-label="폴더 추가" disabled={!newFolderName.trim() || creating}><Plus size={14} aria-hidden /></button>
            </form>
          </div>}

          {showPadExtras && <div className="app-sidebar-section">
            <span className="app-sidebar-section-title"><Clock3 size={13} aria-hidden />최근 방문</span>
            {padSidebar === null
              ? <p className="app-sidebar-empty">불러오는 중…</p>
              : padSidebar.recentBoards.length > 0
              ? <div className="app-sidebar-list">{padSidebar.recentBoards.map((board) => (
                  <Link key={board.id} href={board.href} prefetch={false} className="app-sidebar-list-link" onClick={() => setOpen(false)}><span>{board.title}</span></Link>
                ))}</div>
              : <p className="app-sidebar-empty">아직 방문한 패드가 없습니다.</p>}
          </div>}

          {showQuizExtras && <RecentSidebarSection title="최근 방문" emptyLabel="아직 방문한 퀴즈가 없습니다." data={quizSidebar} pathname={pathname} onNavigate={() => setOpen(false)} />}

          {showFormExtras && <RecentSidebarSection title="최근 방문" emptyLabel="아직 방문한 설문이 없습니다." data={formSidebar} pathname={pathname} onNavigate={() => setOpen(false)} />}
        </div>

        <div
          className="app-sidebar-account-slot"
          onClickCapture={(event) => {
            if ((event.target as Element).closest("a")) setOpen(false);
          }}
        >
          {accountDock}
        </div>
      </aside>
    </>
  );
}
