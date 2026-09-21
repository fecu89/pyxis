"use client";

import { useCallback, useState } from "react";
import { Check, Eye, KeyRound, LoaderCircle, LogOut, RefreshCcw, ShieldCheck, Trash2, UserCog } from "lucide-react";
import { ADMIN_ROLE_LABELS } from "@/components/admin/shared/labels";
import { StudentNumberEditor } from "@/components/admin/student-number-editor";
import type { AdminActor, AdminUserRecord, SchoolDirectoryItem, SystemPermission, UserRole, UserStatus } from "@/components/admin/types";
import { useConfirm } from "@/components/ui/app-dialog";
import { Modal } from "@/components/ui/modal";

const permissionLabels: Record<SystemPermission, string> = {
  VIEW_USERS: "사용자 목록 조회",
  CHANGE_NON_ADMIN_ROLES: "학생·교사 역할·소속 변경",
  SUSPEND_USERS: "학생·교사 정지·복구",
  REVOKE_USER_SESSIONS: "사용자 세션 해제",
  VIEW_ALL_BOARDS: "모든 비공개 패드 조회",
  EDIT_ANY_CONTENT: "모든 콘텐츠 수정",
  MODERATE_CONTENT: "모든 콘텐츠 숨김·복구",
  CREATE_CONTENT_ANYWHERE: "모든 패드에 콘텐츠 생성",
  MANAGE_BOARD_SETTINGS: "모든 패드 설정·멤버 관리",
  TRANSFER_BOARD_OWNERSHIP: "패드 소유권 이전",
  VIEW_USER_PII: "개인정보 원문 조회",
  VIEW_AUDIT_LOG: "감사 로그 조회",
  VIEW_ALL_QUIZZES: "모든 퀴즈 조회",
  EDIT_ANY_QUIZ: "모든 퀴즈 수정",
  MANAGE_ANY_SESSION: "모든 세션 진행·종료",
  ISSUE_STUDENT_ACCOUNTS: "학생 계정 발급",
};
const allPermissions = Object.keys(permissionLabels) as SystemPermission[];
const basicPreset: SystemPermission[] = ["VIEW_USERS", "CHANGE_NON_ADMIN_ROLES", "SUSPEND_USERS", "REVOKE_USER_SESSIONS", "VIEW_AUDIT_LOG"];
// 운영 프리셋은 콘텐츠 관리 권한 묶음입니다. 패드와 퀴즈를 함께 다루므로 양쪽 권한을 같이 줍니다.
const operationsPreset: SystemPermission[] = [
  ...basicPreset,
  "VIEW_ALL_BOARDS", "EDIT_ANY_CONTENT", "MODERATE_CONTENT", "MANAGE_BOARD_SETTINGS", "TRANSFER_BOARD_OWNERSHIP",
  "VIEW_ALL_QUIZZES", "EDIT_ANY_QUIZ", "MANAGE_ANY_SESSION",
];

function groupType(role: UserRole) {
  if (role === "STUDENT") return "CLASS";
  if (role === "TEACHER") return "DEPARTMENT";
  return null;
}

type UserAdminActionsProps = {
  actor: AdminActor;
  user: AdminUserRecord;
  schools: SchoolDirectoryItem[];
  onClose: () => void;
  onUpdated: (user: AdminUserRecord) => void;
  onDeleted: (userId: string) => void;
  onAuditChanged: () => void;
};

async function responseJson(response: Response) {
  const result = await response.json().catch(() => ({ error: "서버 응답을 확인하지 못했습니다." }));
  if (!response.ok) throw new Error(result.error || "요청을 처리하지 못했습니다.");
  return result;
}

function useAdminAction(setMessage: (message: string) => void, clearPii: () => void) {
  const [pending, setPending] = useState(false);
  const run = useCallback(async (action: () => Promise<void>) => {
    setPending(true);
    setMessage("");
    clearPii();
    try {
      await action();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "요청을 처리하지 못했습니다.");
    } finally {
      setPending(false);
    }
  }, [clearPii, setMessage]);
  return { pending, run };
}

// 매 행에 무거운 상세 편집기를 렌더링하지 않고, 실제로 ⋯를 누른 사용자 한 명에 대해서만
// 역할·상태·소속을 포함한 모든 개별 수정 작업을 모달로 마운트합니다. 목록 카드는 이제 요약만
// 보여주고, 실제 변경은 전부 여기(단일 사용자) 또는 다중 선택 후 일괄 작업에서만 합니다.
export function UserAdminActions({
  actor,
  user,
  schools,
  onClose,
  onUpdated,
  onDeleted,
  onAuditChanged,
}: UserAdminActionsProps) {
  const confirm = useConfirm();
  const [role, setRole] = useState<UserRole>(user.role);
  const [status, setStatus] = useState<UserStatus>(user.status);
  const [schoolId, setSchoolId] = useState(user.school?.id ?? "");
  const [schoolGroupId, setSchoolGroupId] = useState(user.schoolGroup?.id ?? "");
  const [permissions, setPermissions] = useState<SystemPermission[]>(user.systemPermissions);
  const [isSchoolRepresentative, setIsSchoolRepresentative] = useState(user.isSchoolRepresentative);
  const [message, setMessage] = useState("");
  const [pii, setPii] = useState<{
    loginIdentifier: string;
    loginType: "LOGIN_ID" | "KAKAO_EMAIL";
    name: string | null;
    image: string | null;
  } | null>(null);
  const [temporaryPassword, setTemporaryPassword] = useState("");
  const [specifyPasswordOpen, setSpecifyPasswordOpen] = useState(false);
  const [newPassword, setNewPassword] = useState("");
  const [newPasswordConfirm, setNewPasswordConfirm] = useState("");
  const passwordRules = {
    length: newPassword.length >= 10,
    letter: /[A-Za-z]/u.test(newPassword),
    number: /[0-9]/u.test(newPassword),
    symbol: /[^A-Za-z0-9\s]/u.test(newPassword),
    confirm: Boolean(newPasswordConfirm) && newPassword === newPasswordConfirm,
  };
  const clearPii = useCallback(() => { setPii(null); setTemporaryPassword(""); }, []);
  const { pending, run } = useAdminAction(setMessage, clearPii);
  const [basicInfoPending, setBasicInfoPending] = useState(false);
  const anyPending = pending || basicInfoPending;
  const actorPermissions = new Set(actor.systemPermissions);
  const targetIsNonAdmin = user.role === "STUDENT" || user.role === "TEACHER";
  const isSelf = actor.id === user.id;
  const canManageAsRepresentative = actor.role === "TEACHER"
    && actor.isSchoolRepresentative
    && targetIsNonAdmin
    // actor.school?.id === user.school?.id만 쓰면 둘 다 학교가 없을 때 undefined === undefined로
    // 참이 된다 — 대표교사에게 소속 학교가 없어야 하는 상태 자체가 비정상이지만, 방어적으로 actor의
    // 학교 id가 실제로 있어야만 같은 학교로 인정한다.
    && Boolean(actor.school?.id)
    && actor.school?.id === user.school?.id;
  // 학생 비밀번호는 canManageAsRepresentative(교사·학생 모두 대상)보다 좁습니다 — 학교 대표교사가
  // 아니어도 ISSUE_STUDENT_ACCOUNTS 권한을 가진 보조관리자면 통과해야 하고, 대상은 학생만입니다.
  const canManageStudentAccount = user.role === "STUDENT" && (
    actor.role === "SUPER_ADMIN"
    || actorPermissions.has("ISSUE_STUDENT_ACCOUNTS")
    || canManageAsRepresentative
  );
  const canChangeRole = !isSelf && (
    actor.role === "SUPER_ADMIN"
    || (targetIsNonAdmin && actorPermissions.has("CHANGE_NON_ADMIN_ROLES"))
  );
  const canChangeStatus = !isSelf && (
    actor.role === "SUPER_ADMIN"
    || (targetIsNonAdmin && actorPermissions.has("SUSPEND_USERS"))
  );
  const canChangeSchool = !isSelf && (
    actor.role === "SUPER_ADMIN"
    || (targetIsNonAdmin && actorPermissions.has("CHANGE_NON_ADMIN_ROLES"))
  );
  const canChangeGroup = canChangeSchool || (!isSelf && canManageAsRepresentative);
  const canChangeStudentNumber = user.role === "STUDENT" && (
    actor.role === "SUPER_ADMIN"
    || (actor.role === "ADMIN" && actorPermissions.has("VIEW_USERS"))
    || (actor.role === "TEACHER" && actor.school?.id === user.school?.id)
  );
  const canRevokeSessions = actor.role === "SUPER_ADMIN"
    || (targetIsNonAdmin && actorPermissions.has("REVOKE_USER_SESSIONS"));
  const canManagePassword = (canRevokeSessions || canManageStudentAccount) && user.hasPasswordCredential && actor.id !== user.id;
  const canViewPii = actor.role === "SUPER_ADMIN" || actorPermissions.has("VIEW_USER_PII");
  const showBasicInfoEditor = canChangeRole || canChangeStatus || canChangeSchool || canChangeGroup;
  const roleOptions: UserRole[] = actor.role === "SUPER_ADMIN"
    ? ["SUPER_ADMIN", "ADMIN", "TEACHER", "STUDENT"]
    : targetIsNonAdmin
      ? ["TEACHER", "STUDENT"]
      : [user.role];
  const expectedGroupType = groupType(role);
  const selectedSchool = schools.find((school) => school.id === schoolId) ?? null;
  const availableGroups = selectedSchool?.groups.filter((group) => group.type === expectedGroupType) ?? [];
  const basicInfoDirty = role !== user.role
    || status !== user.status
    || schoolId !== (user.school?.id ?? "")
    || schoolGroupId !== (user.schoolGroup?.id ?? "");

  function changeRoleField(nextRole: UserRole) {
    setRole(nextRole);
    const nextGroupType = groupType(nextRole);
    if (!nextGroupType) { setSchoolGroupId(""); return; }
    const nextSchool = schools.find((school) => school.id === schoolId) ?? schools[0] ?? null;
    setSchoolId(nextSchool?.id ?? "");
    setSchoolGroupId(nextSchool?.groups.find((group) => group.type === nextGroupType)?.id ?? "");
  }

  function changeSchoolField(nextSchoolId: string) {
    setSchoolId(nextSchoolId);
    const school = schools.find((item) => item.id === nextSchoolId) ?? null;
    setSchoolGroupId(expectedGroupType ? school?.groups.find((group) => group.type === expectedGroupType)?.id ?? "" : "");
  }

  // 역할·상태·소속은 예전 목록 인라인 편집처럼 사유 없이 바로 저장합니다(다른 민감한 작업과
  // 달리 되돌리기 쉬운 일상적인 변경이라 매번 사유를 받는 게 과했습니다). 서버는 여전히 사유
  // 문자열을 필수로 요구하므로, 무엇이 바뀌었는지 담은 사유를 자동으로 만들어 보냅니다.
  async function saveBasicInfo() {
    const changedLabels: string[] = [];
    const patch: Record<string, unknown> = {};
    if (canChangeRole && role !== user.role) { patch.role = role; changedLabels.push("역할"); }
    if (canChangeStatus && status !== user.status) { patch.status = status; changedLabels.push("상태"); }
    if (canChangeSchool && schoolId !== (user.school?.id ?? "")) { patch.schoolId = schoolId || null; changedLabels.push("학교"); }
    if (canChangeGroup && schoolGroupId !== (user.schoolGroup?.id ?? "")) { patch.schoolGroupId = schoolGroupId || null; changedLabels.push("반·부서"); }
    if (!changedLabels.length) return;
    setBasicInfoPending(true);
    setMessage("");
    clearPii();
    try {
      const result = await responseJson(await fetch(`/api/admin/users/${user.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...patch, reason: `관리자 상세 정보에서 ${changedLabels.join("·")} 직접 변경` }),
      }));
      onUpdated(result.user);
      onAuditChanged();
      setMessage("기본 정보를 저장했습니다.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "저장하지 못했습니다.");
    } finally {
      setBasicInfoPending(false);
    }
  }

  function togglePermission(permission: SystemPermission) {
    setPermissions((current) => current.includes(permission)
      ? current.filter((item) => item !== permission)
      : [...current, permission]);
  }

  async function updatePermissions() {
    await run(async () => {
      const result = await responseJson(await fetch(`/api/admin/users/${user.id}/permissions`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ permissions, reason: "관리자 상세 작업에서 보조관리자 시스템 권한 변경" }),
      }));
      onUpdated({ ...user, systemPermissions: result.permissions, authVersion: user.authVersion + 1 });
      onAuditChanged();
      setMessage("보조관리자 권한을 저장하고 기존 세션을 해제했습니다.");
    });
  }

  async function updateRepresentative() {
    await run(async () => {
      const result = await responseJson(await fetch(`/api/admin/users/${user.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ isSchoolRepresentative, reason: `관리자 상세 작업에서 학교 대표교사 ${isSchoolRepresentative ? "지정" : "해제"}` }),
      }));
      onUpdated(result.user);
      onAuditChanged();
      setMessage("학교 대표교사 설정을 변경했습니다.");
    });
  }

  async function revokeSessions() {
    await run(async () => {
      await responseJson(await fetch(`/api/admin/users/${user.id}/revoke-sessions`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ reason: "관리자 상세 작업에서 세션 일괄 해제" }),
      }));
      onUpdated({ ...user, authVersion: user.authVersion + 1 });
      onAuditChanged();
      setMessage("기존 로그인 세션을 모두 해제했습니다.");
    });
  }

  async function resetPassword() {
    if (!(await confirm(`${user.name || "이 사용자"}의 비밀번호를 임시 비밀번호로 초기화할까요?\n기존 세션은 모두 해제됩니다.`))) return;
    await run(async () => {
      const result = await responseJson(await fetch(`/api/admin/users/${user.id}/password-reset`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ reason: "관리자 상세 작업에서 비밀번호 초기화" }),
      }));
      setTemporaryPassword(result.temporaryPassword);
      onUpdated({ ...user, authVersion: result.authVersion, mustChangePassword: true });
      onAuditChanged();
      setMessage("임시 비밀번호를 발급하고 기존 로그인 세션을 모두 해제했습니다.");
    });
  }

  async function setSpecificPassword() {
    if (!(await confirm(`${user.name || "이 사용자"}의 비밀번호를 입력한 값으로 바꿀까요?\n기존 세션은 모두 해제됩니다.`))) return;
    await run(async () => {
      const result = await responseJson(await fetch(`/api/admin/users/${user.id}/password-reset`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ reason: "관리자 상세 작업에서 비밀번호 지정", password: newPassword }),
      }));
      onUpdated({ ...user, authVersion: result.authVersion, mustChangePassword: true });
      onAuditChanged();
      setSpecifyPasswordOpen(false);
      setNewPassword("");
      setNewPasswordConfirm("");
      setMessage("지정한 비밀번호로 변경하고 기존 로그인 세션을 모두 해제했습니다.");
    });
  }

  async function viewPii() {
    await run(async () => {
      const result = await responseJson(await fetch(`/api/admin/users/${user.id}/pii`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ reason: "관리자 상세 작업에서 개인정보 원문 조회" }),
      }));
      setPii(result.pii);
      onAuditChanged();
      setMessage("개인정보 원문은 이 모달에서만 일시적으로 표시됩니다.");
    });
  }

  async function deleteAccount() {
    if (!(await confirm({ description: `${user.name || "이 회원"} 계정을 삭제할까요?\n개인정보와 로그인 권한이 제거되며 되돌릴 수 없습니다.`, confirmLabel: "삭제", danger: true }))) return;
    await run(async () => {
      await responseJson(await fetch(`/api/admin/users/${user.id}`, {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ reason: "관리자 상세 작업에서 회원 삭제" }),
      }));
      onAuditChanged();
      onDeleted(user.id);
      onClose();
    });
  }

  return (
    <Modal
      open
      onClose={onClose}
      title={`${user.name || "이름 없음"} 상세 작업`}
      description="역할·상태·소속 변경부터 민감한 작업까지 이 사용자에 대한 모든 개별 수정을 여기서 합니다. 여러 명을 한 번에 바꾸려면 목록에서 다중 선택 후 일괄 작업을 쓰세요."
      className="admin-user-actions-modal"
    >
      <div className="admin-user-actions">
        <section className="admin-user-summary">
          <span className={`admin-avatar ${user.status !== "ACTIVE" ? "suspended" : ""}`}>{(user.name || "?")[0]}</span>
          <div><b>{user.name || "이름 없음"}</b><span>{user.loginIdentifier}</span><small>소유 패드 {user.ownedBoardCount} · 참여 패드 {user.memberBoardCount} · 최근 로그인 {user.lastLoginAt ? new Date(user.lastLoginAt).toLocaleDateString("ko-KR", { timeZone: "Asia/Seoul" }) : "없음"}</small></div>
        </section>

        {showBasicInfoEditor && (
          <section className="admin-basic-info-editor" aria-labelledby={`basic-info-title-${user.id}`}>
            <div className="admin-basic-info-heading"><UserCog size={17} /><h3 id={`basic-info-title-${user.id}`}>역할·상태·소속</h3></div>
            <div className="admin-basic-info-fields">
              <label>
                <span>권한</span>
                {canChangeRole
                  ? <select className="admin-inline-select" value={role} onChange={(event) => changeRoleField(event.target.value as UserRole)} disabled={anyPending}>{roleOptions.map((option) => <option key={option} value={option}>{ADMIN_ROLE_LABELS[option]}</option>)}</select>
                  : <span className={`role-badge ${user.role.toLowerCase()}`}>{ADMIN_ROLE_LABELS[user.role]}</span>}
              </label>
              <label>
                <span>상태</span>
                {canChangeStatus
                  ? <select className="admin-inline-select" value={status} onChange={(event) => setStatus(event.target.value as UserStatus)} disabled={anyPending}><option value="ACTIVE">활성</option><option value="SUSPENDED">정지</option></select>
                  : <span className={`status-dot ${user.status.toLowerCase()}`}>{user.status === "ACTIVE" ? "활성" : "정지"}</span>}
              </label>
              <label>
                <span>학교</span>
                {canChangeSchool
                  ? <select className="admin-inline-select" value={schoolId} onChange={(event) => changeSchoolField(event.target.value)} disabled={anyPending}><option value="">학교 없음</option>{schools.map((school) => <option key={school.id} value={school.id}>{school.name}</option>)}</select>
                  : <span>{user.school?.name ?? "미지정"}</span>}
              </label>
              <label>
                <span>{expectedGroupType === "DEPARTMENT" ? "부서" : "반"}</span>
                {canChangeGroup
                  ? <select className="admin-inline-select" value={schoolGroupId} onChange={(event) => setSchoolGroupId(event.target.value)} disabled={anyPending || !expectedGroupType || !schoolId}><option value="">{expectedGroupType ? "소속 선택" : "해당 없음"}</option>{availableGroups.map((group) => <option key={group.id} value={group.id}>{group.name}</option>)}</select>
                  : <span>{user.schoolGroup?.name ?? "소속 없음"}</span>}
              </label>
            </div>
            {user.role === "STUDENT" && (
              <div className="admin-basic-info-student-number">
                <span>학생 번호</span>
                {canChangeStudentNumber
                  ? <StudentNumberEditor userId={user.id} userName={user.name || "학생"} initialValue={user.studentNumber} source="사용자 관리" onSaved={onUpdated} />
                  : <span>{user.studentNumber ? `${user.studentNumber}번` : "번호 미지정"}</span>}
              </div>
            )}
            <button type="button" className="button soft full" onClick={() => void saveBasicInfo()} disabled={anyPending || !basicInfoDirty}>{basicInfoPending ? <LoaderCircle size={16} className="spin" /> : <UserCog size={16} />}기본 정보 저장</button>
          </section>
        )}

        {actor.role === "SUPER_ADMIN" && user.role === "ADMIN" && (
          <section className="permission-editor" aria-labelledby={`permission-title-${user.id}`}>
            <div className="permission-heading"><div><ShieldCheck size={17} /><h3 id={`permission-title-${user.id}`}>보조관리자 시스템 권한</h3></div><div><button type="button" onClick={() => setPermissions(basicPreset)}>기본</button><button type="button" onClick={() => setPermissions(operationsPreset)}>전체 운영</button></div></div>
            <fieldset disabled={anyPending}>
              <legend className="sr-only">부여할 시스템 권한</legend>
              {allPermissions.map((permission) => <label key={permission}><input type="checkbox" checked={permissions.includes(permission)} onChange={() => togglePermission(permission)} /><span>{permissionLabels[permission]}</span></label>)}
            </fieldset>
            <button type="button" className="button soft full" onClick={() => void updatePermissions()} disabled={anyPending}><KeyRound size={16} />시스템 권한 저장</button>
          </section>
        )}

        {actor.role === "SUPER_ADMIN" && user.role === "TEACHER" && (
          <section className="admin-representative-setting">
            <div><UserCog size={17} /><span><b>학교 대표교사</b><small>자기 학교 안에서 학생·교사 배치와 반·부서를 관리할 수 있습니다.</small></span></div>
            <label><input type="checkbox" checked={isSchoolRepresentative} onChange={(event) => setIsSchoolRepresentative(event.target.checked)} disabled={anyPending} /><span>{isSchoolRepresentative ? "지정됨" : "지정 안 함"}</span></label>
            <button type="button" className="button soft" onClick={() => void updateRepresentative()} disabled={anyPending || isSchoolRepresentative === user.isSchoolRepresentative}>대표교사 설정 저장</button>
          </section>
        )}

        <section className="admin-sensitive-actions" aria-label="보안 작업">
          {canManagePassword ? <button type="button" className="button ghost" onClick={() => void resetPassword()} disabled={anyPending}><RefreshCcw size={15} />비밀번호 초기화</button> : null}
          {canManagePassword ? <button type="button" className="button ghost" onClick={() => setSpecifyPasswordOpen((open) => !open)} disabled={anyPending}><KeyRound size={15} />비밀번호 지정하기</button> : null}
          {canRevokeSessions && <button type="button" className="button ghost" onClick={() => void revokeSessions()} disabled={anyPending}><LogOut size={15} />세션 모두 해제</button>}
          {canViewPii && <button type="button" className="button ghost" onClick={() => void viewPii()} disabled={anyPending}><Eye size={15} />개인정보 원문 보기</button>}
          {actor.role === "SUPER_ADMIN" && actor.id !== user.id && <button type="button" className="button danger" onClick={() => void deleteAccount()} disabled={anyPending}><Trash2 size={15} />회원 삭제</button>}
        </section>

        {specifyPasswordOpen && (
          <section className="admin-password-specify-form" aria-label="비밀번호 지정">
            <label>새 비밀번호<input type="password" value={newPassword} onChange={(event) => setNewPassword(event.target.value)} autoComplete="new-password" minLength={10} maxLength={128} disabled={anyPending} /></label>
            <ul className="auth-password-rules" aria-label="새 비밀번호 조건">
              <li data-met={passwordRules.length}><Check size={12} />10자 이상</li>
              <li data-met={passwordRules.letter}><Check size={12} />영문자</li>
              <li data-met={passwordRules.number}><Check size={12} />숫자</li>
              <li data-met={passwordRules.symbol}><Check size={12} />특수문자</li>
            </ul>
            <label>새 비밀번호 확인<input type="password" value={newPasswordConfirm} onChange={(event) => setNewPasswordConfirm(event.target.value)} autoComplete="new-password" minLength={10} maxLength={128} disabled={anyPending} /></label>
            {newPasswordConfirm ? <span className="password-confirm-state" data-valid={passwordRules.confirm}>{passwordRules.confirm ? "비밀번호가 일치합니다." : "비밀번호가 일치하지 않습니다."}</span> : null}
            <div className="admin-password-specify-actions">
              <button type="button" className="button ghost" onClick={() => { setSpecifyPasswordOpen(false); setNewPassword(""); setNewPasswordConfirm(""); }} disabled={anyPending}>취소</button>
              <button type="button" className="button primary" onClick={() => void setSpecificPassword()} disabled={anyPending || !Object.values(passwordRules).every(Boolean)}>이 비밀번호로 변경</button>
            </div>
          </section>
        )}

        {anyPending && <p className="admin-action-pending"><LoaderCircle size={15} className="spin" />처리 중입니다.</p>}
        {message && <p className="admin-message" aria-live="polite">{message}</p>}
        {temporaryPassword ? <div className="admin-temporary-password" role="status"><span><b>임시 비밀번호</b><small>이 창을 닫으면 다시 확인할 수 없습니다.</small></span><code>{temporaryPassword}</code><button type="button" className="button soft" onClick={() => void navigator.clipboard.writeText(temporaryPassword)}>복사</button></div> : null}
        {pii && <dl className="pii-result"><div><dt>{pii.loginType === "KAKAO_EMAIL" ? "카카오 이메일" : "로그인 아이디"}</dt><dd>{pii.loginIdentifier}</dd></div><div><dt>이름</dt><dd>{pii.name || "없음"}</dd></div><div><dt>프로필 URL</dt><dd>{pii.image || "없음"}</dd></div></dl>}
        <p className="admin-policy-note">민감한 작업은 감사 로그에 자동으로 기록됩니다. 개인정보 원문은 필요한 확인을 마치면 모달을 닫아 주세요.</p>
      </div>
    </Modal>
  );
}
