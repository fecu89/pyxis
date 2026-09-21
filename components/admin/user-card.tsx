"use client";

import { Building2, Check, LogIn, MoreHorizontal, NotebookText } from "lucide-react";
import { ADMIN_ROLE_LABELS } from "@/components/admin/shared/labels";
import type { AdminActor, AdminUserRecord } from "@/components/admin/types";

function cardIdentifier(user: AdminUserRecord) {
  if (user.loginType !== "KAKAO_EMAIL" || user.loginIdentifier.length <= 30) return user.loginIdentifier;
  const separator = user.loginIdentifier.lastIndexOf("@");
  if (separator <= 0) return `${user.loginIdentifier.slice(0, 27)}…`;
  const local = user.loginIdentifier.slice(0, separator);
  const domain = user.loginIdentifier.slice(separator + 1);
  const shortLocal = local.length > 12 ? `${local.slice(0, 12)}…` : local;
  const shortDomain = domain.length > 16 ? `${domain.slice(0, 15)}…` : domain;
  return `${shortLocal}@${shortDomain}`;
}

function organizationPath(user: AdminUserRecord) {
  const parts = [user.school?.name, user.schoolGroup?.name];
  if (user.role === "STUDENT") parts.push(user.studentNumber ? `${user.studentNumber}번` : "번호 미지정");
  const path = parts.filter(Boolean).join(" > ");
  return path || "소속 없음";
}

type UserCardProps = {
  actor: AdminActor;
  user: AdminUserRecord;
  selected: boolean;
  selectionDisabled: boolean;
  onToggleSelected: () => void;
  onSelectRow: (event: { shiftKey: boolean }) => void;
  onOpenActions: () => void;
};

// 예전에는 행마다 역할·상태·소속을 바로 고칠 수 있는 select 세 개가 박혀 있었는데, 좁은 셀에
// select가 줄줄이 있으니 표가 아니라 양식지처럼 보였습니다. 지금은 이 카드가 순수 요약(배지 +
// 메타 텍스트)만 보여주고, 실제 수정은 전부 "..." 버튼(UserAdminActions 모달) 또는 다중 선택
// 후 일괄 작업(BulkUserActions)에서만 하도록 옮겼습니다 — quiz 프로젝트 회원 관리 카드와 같은
// 방향입니다.
export function UserCard({
  actor,
  user,
  selected,
  selectionDisabled,
  onToggleSelected,
  onSelectRow,
  onOpenActions,
}: UserCardProps) {
  const actorPermissions = new Set(actor.systemPermissions);
  const targetIsNonAdmin = user.role === "STUDENT" || user.role === "TEACHER";
  const isSelf = actor.id === user.id;
  const canManageAsRepresentative = actor.role === "TEACHER"
    && actor.isSchoolRepresentative
    && targetIsNonAdmin
    && actor.school?.id === user.school?.id;
  const canChangeRole = !isSelf && (
    actor.role === "SUPER_ADMIN"
    || (targetIsNonAdmin && actorPermissions.has("CHANGE_NON_ADMIN_ROLES"))
  );
  const canChangeStatus = !isSelf && (
    actor.role === "SUPER_ADMIN"
    || (targetIsNonAdmin && actorPermissions.has("SUSPEND_USERS"))
  );
  const canChangeOrganization = !isSelf && (
    actor.role === "SUPER_ADMIN"
    || (targetIsNonAdmin && actorPermissions.has("CHANGE_NON_ADMIN_ROLES"))
    || canManageAsRepresentative
  );
  const canChangeStudentNumber = user.role === "STUDENT" && (
    actor.role === "SUPER_ADMIN"
    || (actor.role === "ADMIN" && actorPermissions.has("VIEW_USERS"))
    || (actor.role === "TEACHER" && actor.school?.id === user.school?.id)
  );
  const canRevokeSessions = actor.role === "SUPER_ADMIN"
    || (targetIsNonAdmin && actorPermissions.has("REVOKE_USER_SESSIONS"));
  const canViewPii = actor.role === "SUPER_ADMIN" || actorPermissions.has("VIEW_USER_PII");
  const canOpenActions = canChangeRole
    || canChangeStatus
    || canChangeOrganization
    || canChangeStudentNumber
    || canRevokeSessions
    || canViewPii
    || (actor.role === "SUPER_ADMIN" && (user.role === "ADMIN" || user.role === "TEACHER" || !isSelf));
  const canSelectRow = !isSelf && !selectionDisabled;

  function handleCardClick(event: React.MouseEvent) {
    if (!canSelectRow) return;
    if (event.target instanceof Element && event.target.closest("button, a, input")) return;
    onSelectRow({ shiftKey: event.shiftKey });
  }

  return (
    <article
      className={`admin-user-card ${selected ? "selected" : ""} ${canSelectRow ? "selectable" : ""}`}
      onClick={handleCardClick}
      onMouseDown={(event) => { if (event.shiftKey) event.preventDefault(); }}
    >
      {canSelectRow && (
        <input type="checkbox" className="sr-only" checked={selected} onChange={onToggleSelected} aria-label={`${user.name || "이름 없음"} 선택`} />
      )}
      <span className={`admin-avatar small ${user.status !== "ACTIVE" ? "suspended" : ""}`} data-selected={selected} aria-hidden>
        {selected ? <Check size={16} /> : (user.name || "?")[0]}
      </span>
      <div className="admin-user-card-body">
        <div className="admin-user-card-heading">
          <b>{user.name || "이름 없음"}</b>
          <span className={`role-badge ${user.role.toLowerCase()}`}>{ADMIN_ROLE_LABELS[user.role]}</span>
          {user.isSchoolRepresentative && <span className="admin-rep-badge">대표교사</span>}
          <span className={`status-dot ${user.status.toLowerCase()}`}>{user.status === "ACTIVE" ? "활성" : "정지"}</span>
          {user.mustChangePassword && <em className="password-pending">비밀번호 변경 대기</em>}
        </div>
        <div className="admin-user-card-meta">
          <span className="admin-user-card-meta-id">{cardIdentifier(user)}</span>
          <span className="admin-user-card-meta-org"><Building2 size={12} aria-hidden />{organizationPath(user)}</span>
          <span className="admin-user-card-meta-boards"><NotebookText size={12} aria-hidden />{user.ownedBoardCount + user.memberBoardCount}개</span>
          <span className="admin-user-card-meta-login"><LogIn size={12} aria-hidden />{user.lastLoginAt ? new Date(user.lastLoginAt).toLocaleDateString("ko-KR", { timeZone: "Asia/Seoul" }) : "없음"}</span>
        </div>
      </div>
      <button type="button" className="icon-button small" onClick={onOpenActions} disabled={!canOpenActions} aria-label={`${user.name || "사용자"} 상세 작업`}>
        <MoreHorizontal size={17} />
      </button>
    </article>
  );
}
