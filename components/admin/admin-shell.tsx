"use client";

import { Fragment, type ReactNode } from "react";
import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  BadgeCheck,
  Building2,
  ClipboardPen,
  FileSpreadsheet,
  House,
  LayoutDashboard,
  LayoutGrid,
  ListChecks,
  Menu,
  Palette,
  Settings2,
  Shield,
  Users,
  Volume2,
  X,
} from "lucide-react";
import { ADMIN_ROLE_LABELS } from "@/components/admin/shared/labels";
import type { AdminActor, AdminTab } from "@/components/admin/types";
import { DASHBOARD_PATH } from "@/lib/route-paths";
import { ADMIN_SECTION_PATHS } from "@/lib/admin/navigation";

type AdminShellAccess = {
  canViewUsers: boolean;
  canViewSchools: boolean;
  canManageRoster: boolean;
  canViewAudit: boolean;
  canManageTeacherApprovals: boolean;
  canManageSystemSettings: boolean;
  canViewAllBoards: boolean;
  canViewAllQuizzes: boolean;
  canViewAllForms: boolean;
};

const items: Array<{
  id: AdminTab;
  label: string;
  group: "school" | "content" | "system";
  Icon: typeof LayoutDashboard;
  visible: (access: AdminShellAccess) => boolean;
}> = [
  { id: "dashboard", label: "학교 대시보드", group: "school", Icon: LayoutDashboard, visible: (access) => access.canViewSchools },
  { id: "users", label: "사용자 관리", group: "school", Icon: Users, visible: (access) => access.canViewUsers },
  { id: "approvals", label: "가입 승인", group: "school", Icon: BadgeCheck, visible: (access) => access.canManageTeacherApprovals },
  { id: "schools", label: "소속 관리", group: "school", Icon: Building2, visible: (access) => access.canViewSchools },
  { id: "roster", label: "학생 계정 발급", group: "school", Icon: FileSpreadsheet, visible: (access) => access.canManageRoster },
  { id: "boards", label: "전체 패드", group: "content", Icon: LayoutGrid, visible: (access) => access.canViewAllBoards },
  { id: "quizzes", label: "전체 퀴즈", group: "content", Icon: ListChecks, visible: (access) => access.canViewAllQuizzes },
  { id: "forms", label: "전체 설문", group: "content", Icon: ClipboardPen, visible: (access) => access.canViewAllForms },
  { id: "settings", label: "정책", group: "system", Icon: Settings2, visible: (access) => access.canManageSystemSettings },
  { id: "audio", label: "퀴즈 사운드", group: "system", Icon: Volume2, visible: (access) => access.canManageSystemSettings },
  { id: "theme", label: "테마", group: "system", Icon: Palette, visible: (access) => access.canManageSystemSettings },
  { id: "audit", label: "감사 로그", group: "system", Icon: Shield, visible: (access) => access.canViewAudit },
];

const groups = [
  { id: "school", label: "학교 운영" },
  { id: "content", label: "콘텐츠" },
  { id: "system", label: "시스템" },
] as const;

export function AdminShell({ actor, access, children }: { actor: AdminActor; access: AdminShellAccess; children: ReactNode }) {
  const pathname = usePathname();
  const [mobileSidebarOpen, setMobileSidebarOpen] = useState(false);
  const visibleItems = items.filter((item) => item.visible(access));
  const activeItem = visibleItems.find((item) => pathname === ADMIN_SECTION_PATHS[item.id]) ?? visibleItems[0];
  const ActiveIcon = activeItem?.Icon ?? Shield;

  useEffect(() => {
    if (!mobileSidebarOpen) return;
    function closeOnEscape(event: KeyboardEvent) {
      if (event.key === "Escape") setMobileSidebarOpen(false);
    }
    document.addEventListener("keydown", closeOnEscape);
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", closeOnEscape);
      document.body.style.overflow = "";
    };
  }, [mobileSidebarOpen]);

  return (
    <main className="admin-page">
      <header className="admin-mobile-nav">
        <button type="button" className="admin-sidebar-trigger" onClick={() => setMobileSidebarOpen(true)} aria-label="관리 메뉴 열기" aria-expanded={mobileSidebarOpen}>
          <Menu size={19} />
        </button>
        <div className="admin-mobile-title"><ActiveIcon size={17} /><span>{activeItem?.label ?? "관리자 센터"}</span></div>
      </header>
      {mobileSidebarOpen ? <div className="admin-sidebar-backdrop" onClick={() => setMobileSidebarOpen(false)} aria-hidden /> : null}
      <div className="admin-workspace">
        <aside className="admin-sidebar" data-mobile-open={mobileSidebarOpen}>
          <div className="admin-sidebar-heading">
            <div className="admin-sidebar-brand"><span className="admin-sidebar-brand-icon"><Shield size={18} /></span><span><small>ADMIN</small><b>관리자 센터</b></span></div>
            <div className="admin-sidebar-heading-actions">
              <Link href={DASHBOARD_PATH} className="admin-sidebar-home" aria-label="대시보드로 돌아가기" title="대시보드로 돌아가기"><House size={17} /></Link>
              <button type="button" className="admin-sidebar-close" onClick={() => setMobileSidebarOpen(false)} aria-label="관리 메뉴 닫기"><X size={16} /></button>
            </div>
          </div>
          <nav className="admin-sidebar-nav" aria-label="관리자 기능" onClickCapture={() => setMobileSidebarOpen(false)}>
            {groups.map((group) => {
              const groupItems = visibleItems.filter((item) => item.group === group.id);
              if (!groupItems.length) return null;
              return (
                <Fragment key={group.id}>
                  <span className="admin-sidebar-group-label">{group.label}</span>
                  {groupItems.map(({ id, label, Icon }) => (
                    <Link key={id} href={ADMIN_SECTION_PATHS[id]} prefetch={false} aria-current={pathname === ADMIN_SECTION_PATHS[id] ? "page" : undefined}>
                      <span className="admin-sidebar-icon"><Icon size={17} /></span>
                      <b>{label}</b>
                    </Link>
                  ))}
                </Fragment>
              );
            })}
          </nav>
          <div className="admin-sidebar-actor">
            <span className="admin-avatar small">{(actor.name || "?")[0]}</span>
            <div><b>{actor.name || "관리자"}</b><span>{ADMIN_ROLE_LABELS[actor.role]} · {actor.role === "SUPER_ADMIN" ? "전체 권한" : actor.role === "TEACHER" ? actor.isSchoolRepresentative ? "학교 대표관리자" : "학생 번호 관리" : `권한 ${actor.systemPermissions.length}개`}</span></div>
          </div>
        </aside>
        <div className="admin-workspace-content">{children}</div>
      </div>
    </main>
  );
}
