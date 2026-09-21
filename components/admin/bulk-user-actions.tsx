"use client";

import { useState, type FormEvent } from "react";
import { ArrowRightLeft, LoaderCircle, Power, School, ShieldCheck, Trash2, TriangleAlert, Users, X } from "lucide-react";
import type { AdminActor, AdminUserRecord, SchoolDirectoryItem, UserRole, UserStatus } from "@/components/admin/types";
import { useConfirm } from "@/components/ui/app-dialog";

export type BulkUpdateResult = { updated: string[]; deleted?: string[]; skipped: { userId: string; reason: string }[] };

type BulkMode = "ROLE" | "STATUS" | "ORGANIZATION" | "MOVE";

async function responseJson(response: Response) {
  const result = await response.json().catch(() => ({ error: "서버 응답을 확인하지 못했습니다." }));
  if (!response.ok) throw new Error(result.error || "요청을 처리하지 못했습니다.");
  return result;
}

export function BulkUserActions({ actor, selectedIds, selectedUsers, schools, onClose, onApplied }: {
  actor: AdminActor;
  selectedIds: string[];
  selectedUsers: AdminUserRecord[];
  schools: SchoolDirectoryItem[];
  onClose: () => void;
  onApplied: (result: BulkUpdateResult) => void;
}) {
  const confirm = useConfirm();
  const isRepresentative = actor.role === "TEACHER" && actor.isSchoolRepresentative;
  const selectedRoles = new Set(selectedUsers.map((user) => user.role));
  const selectedRole = selectedRoles.size === 1 ? [...selectedRoles][0] : null;
  const canMoveStudents = selectedUsers.length > 0
    && selectedUsers.every((user) => user.role === "STUDENT")
    && (actor.role === "SUPER_ADMIN"
      || (actor.role === "ADMIN" && actor.systemPermissions.includes("CHANGE_NON_ADMIN_ROLES"))
      || isRepresentative);
  const [mode, setMode] = useState<BulkMode>(isRepresentative ? "ORGANIZATION" : "ROLE");
  const [role, setRole] = useState<UserRole>(selectedRole ?? "STUDENT");
  const [status, setStatus] = useState<UserStatus>("ACTIVE");
  const [schoolId, setSchoolId] = useState("");
  const [schoolGroupId, setSchoolGroupId] = useState("");
  const [moveSchoolId, setMoveSchoolId] = useState("");
  const [moveSchoolGroupId, setMoveSchoolGroupId] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const activeMode: BulkMode = mode === "MOVE" && !canMoveStudents
    ? (isRepresentative ? "ORGANIZATION" : "ROLE")
    : mode;

  const groupType = selectedRole === "STUDENT" ? "CLASS" : selectedRole === "TEACHER" ? "DEPARTMENT" : null;
  const groupPlaceholder = groupType === "CLASS" ? "반 선택" : groupType === "DEPARTMENT" ? "부서 선택" : "반·부서 선택";
  const targetSchoolId = schoolId === "__NONE__" ? "" : schoolId;
  const availableGroups = schools.find((school) => school.id === targetSchoolId)?.groups.filter((group) => !groupType || group.type === groupType) ?? [];
  const moveClasses = schools.find((school) => school.id === moveSchoolId)?.groups.filter((group) => group.type === "CLASS") ?? [];
  const canSubmit = activeMode === "ORGANIZATION"
    ? Boolean(schoolId)
    : activeMode === "MOVE"
      ? Boolean(moveSchoolGroupId)
      : true;

  function chooseMode(nextMode: BulkMode) {
    setMode(nextMode);
    setError("");
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!canSubmit) return;
    setPending(true);
    setError("");
    try {
      if (activeMode === "MOVE") {
        const movedResult = await responseJson(await fetch("/api/admin/students/move", {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            userIds: selectedIds,
            schoolGroupId: moveSchoolGroupId,
            reason: `관리자 대시보드에서 반 일괄 이동 (${selectedIds.length}명)`,
          }),
        })) as { moved: { userId: string }[] };
        onApplied({ updated: movedResult.moved.map(({ userId }) => userId), skipped: [] });
        return;
      }

      const modeLabel = activeMode === "ROLE" ? "역할" : activeMode === "STATUS" ? "상태" : "소속";
      const result = await responseJson(await fetch("/api/admin/users/bulk", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          userIds: selectedIds,
          reason: `관리자 대시보드에서 ${modeLabel} 일괄 변경 (${selectedIds.length}명)`,
          ...(activeMode === "ROLE" ? { role } : {}),
          ...(activeMode === "STATUS" ? { status } : {}),
          ...(activeMode === "ORGANIZATION" ? {
            schoolId: schoolId === "__NONE__" ? null : schoolId,
            schoolGroupId: schoolId === "__NONE__" ? null : schoolGroupId || null,
          } : {}),
        }),
      }));
      onApplied(result as BulkUpdateResult);
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : "일괄 수정에 실패했습니다.");
    } finally {
      setPending(false);
    }
  }

  async function deleteSelected() {
    if (!(await confirm({ description: `${selectedIds.length}명의 계정을 삭제할까요?\n개인정보가 제거되고 즉시 로그아웃되며, 이 작업은 되돌릴 수 없습니다.`, confirmLabel: "삭제", danger: true }))) return;
    setPending(true);
    setError("");
    try {
      const result = await responseJson(await fetch("/api/admin/users/bulk", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userIds: selectedIds, reason: `관리자 대시보드에서 회원 일괄 삭제 (${selectedIds.length}명)` }),
      }));
      onApplied(result as BulkUpdateResult);
    } catch (deleteError) {
      setError(deleteError instanceof Error ? deleteError.message : "회원을 일괄 삭제하지 못했습니다.");
    } finally {
      setPending(false);
    }
  }

  return (
    <form className="admin-bulk-bar" onSubmit={submit} aria-label="선택 사용자 설정 변경">
      <div className="admin-bulk-header">
        <div className="admin-bulk-summary"><Users size={15} aria-hidden /><b>{selectedIds.length}명</b> 선택</div>
        <div className="admin-bulk-modes" aria-label="변경할 항목">
          {!isRepresentative ? <button type="button" aria-pressed={activeMode === "ROLE"} onClick={() => chooseMode("ROLE")} disabled={pending}><ShieldCheck size={14} /><span>역할</span></button> : null}
          {!isRepresentative ? <button type="button" aria-pressed={activeMode === "STATUS"} onClick={() => chooseMode("STATUS")} disabled={pending}><Power size={14} /><span>상태</span></button> : null}
          <button type="button" aria-pressed={activeMode === "ORGANIZATION"} onClick={() => chooseMode("ORGANIZATION")} disabled={pending}><School size={14} /><span>소속</span></button>
          {canMoveStudents ? <button type="button" aria-pressed={activeMode === "MOVE"} onClick={() => chooseMode("MOVE")} disabled={pending}><ArrowRightLeft size={14} /><span>반 이동</span></button> : null}
        </div>
        <div className="admin-bulk-window-actions">
          {actor.role === "SUPER_ADMIN" ? <button type="button" className="icon-button small danger" onClick={() => void deleteSelected()} disabled={pending} aria-label="선택 회원 삭제" title="선택 회원 삭제"><Trash2 size={15} /></button> : null}
          <button type="button" className="icon-button small" onClick={onClose} disabled={pending} aria-label="설정 창 닫기"><X size={16} /></button>
        </div>
      </div>

      <div className="admin-bulk-compact-controls">
        {activeMode === "ROLE" ? <label><span>바꿀 역할</span><select className="admin-inline-select" value={role} onChange={(event) => setRole(event.target.value as UserRole)} disabled={pending}><option value="STUDENT">학생</option><option value="TEACHER">교사</option><option value="ADMIN">보조관리자</option><option value="SUPER_ADMIN">전체관리자</option></select></label> : null}
        {activeMode === "STATUS" ? <label><span>바꿀 상태</span><select className="admin-inline-select" value={status} onChange={(event) => setStatus(event.target.value as UserStatus)} disabled={pending}><option value="ACTIVE">활성</option><option value="SUSPENDED">정지</option></select></label> : null}
        {activeMode === "ORGANIZATION" ? <>
          <label><span>학교</span><select className="admin-inline-select" value={schoolId} onChange={(event) => { setSchoolId(event.target.value); setSchoolGroupId(""); }} disabled={pending}><option value="">학교 선택</option><option value="__NONE__">소속 없음</option>{schools.map((school) => <option key={school.id} value={school.id}>{school.name}</option>)}</select></label>
          <label><span>{groupPlaceholder}</span><select className="admin-inline-select" value={schoolGroupId} onChange={(event) => setSchoolGroupId(event.target.value)} disabled={pending || !targetSchoolId}><option value="">{groupPlaceholder}</option>{availableGroups.map((group) => <option key={group.id} value={group.id}>{group.name}</option>)}</select></label>
        </> : null}
        {activeMode === "MOVE" ? <>
          <label><span>학교</span><select className="admin-inline-select" value={moveSchoolId} onChange={(event) => { setMoveSchoolId(event.target.value); setMoveSchoolGroupId(""); }} disabled={pending}><option value="">학교 선택</option>{schools.map((school) => <option key={school.id} value={school.id}>{school.name}</option>)}</select></label>
          <label><span>도착 반</span><select className="admin-inline-select" value={moveSchoolGroupId} onChange={(event) => setMoveSchoolGroupId(event.target.value)} disabled={pending || !moveSchoolId}><option value="">도착 반 선택</option>{moveClasses.map((group) => <option key={group.id} value={group.id}>{group.name}</option>)}</select></label>
        </> : null}
        <button type="submit" className="button primary admin-bulk-apply" disabled={pending || !canSubmit}>{pending ? <LoaderCircle size={15} className="spin" /> : null}{activeMode === "MOVE" ? "반 이동" : "변경 적용"}</button>
      </div>

      {activeMode === "MOVE" ? <p className="admin-bulk-note">도착 반의 빈 번호를 앞에서부터 자동 배정합니다.</p> : null}
      {error ? <p className="admin-bulk-error" role="alert"><TriangleAlert size={14} aria-hidden />{error}</p> : null}
    </form>
  );
}
