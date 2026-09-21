import "server-only";

import type { UserRole } from "@/generated/prisma/client";
import type { AuthorizationUser } from "@/lib/auth/authorization";
import { AuthorizationError, hasSystemPermission } from "@/lib/auth/authorization";

const NON_ADMIN_ROLES: UserRole[] = ["STUDENT", "TEACHER"];

export function canChangeUserRole(actor: AuthorizationUser, currentRole: UserRole, nextRole: UserRole) {
  if (actor.role === "SUPER_ADMIN") return true;
  return hasSystemPermission(actor, "CHANGE_NON_ADMIN_ROLES")
    && NON_ADMIN_ROLES.includes(currentRole)
    && NON_ADMIN_ROLES.includes(nextRole);
}

export function canChangeUserStatus(actor: AuthorizationUser, targetRole: UserRole) {
  if (actor.role === "SUPER_ADMIN") return true;
  return hasSystemPermission(actor, "SUSPEND_USERS") && NON_ADMIN_ROLES.includes(targetRole);
}

export function canRevokeTargetSessions(actor: AuthorizationUser, targetRole: UserRole) {
  if (actor.role === "SUPER_ADMIN") return true;
  return hasSystemPermission(actor, "REVOKE_USER_SESSIONS") && NON_ADMIN_ROLES.includes(targetRole);
}

export function canManageUserOrganization(actor: AuthorizationUser, targetRole: UserRole) {
  if (actor.role === "SUPER_ADMIN") return true;
  return hasSystemPermission(actor, "CHANGE_NON_ADMIN_ROLES") && NON_ADMIN_ROLES.includes(targetRole);
}

export function assertCanChangeUserRole(actor: AuthorizationUser, currentRole: UserRole, nextRole: UserRole) {
  if (!canChangeUserRole(actor, currentRole, nextRole)) {
    throw new AuthorizationError("이 사용자의 역할을 변경할 권한이 없습니다.");
  }
}

export function assertCanChangeUserStatus(actor: AuthorizationUser, targetRole: UserRole) {
  if (!canChangeUserStatus(actor, targetRole)) {
    throw new AuthorizationError("이 사용자의 상태를 변경할 권한이 없습니다.");
  }
}

export function assertCanRevokeTargetSessions(actor: AuthorizationUser, targetRole: UserRole) {
  if (!canRevokeTargetSessions(actor, targetRole)) {
    throw new AuthorizationError("이 사용자의 세션을 해제할 권한이 없습니다.");
  }
}

export function assertCanManageUserOrganization(actor: AuthorizationUser, targetRole: UserRole) {
  if (!canManageUserOrganization(actor, targetRole)) {
    throw new AuthorizationError("이 사용자의 학교·소속을 변경할 권한이 없습니다.");
  }
}

// 학교 대표교사(TEACHER + isSchoolRepresentative)는 자기 학교 안의 학생·교사 배치만 바꿀 수
// 있습니다 — 역할·상태는 못 바꾸고, 대상이 이미 그 학교 소속이어야 합니다(다른 학교에서
// 데려오거나 다른 학교로 보내는 건 SUPER_ADMIN만).
export function canManageSchoolPlacement(actor: AuthorizationUser, target: { role: UserRole; schoolId: string | null }) {
  if (actor.role === "SUPER_ADMIN") return true;
  return actor.role === "TEACHER"
    && actor.isSchoolRepresentative
    && actor.school !== null
    && actor.school.id === target.schoolId
    && (target.role === "STUDENT" || target.role === "TEACHER");
}

export function assertCanManageSchoolPlacement(actor: AuthorizationUser, target: { role: UserRole; schoolId: string | null }) {
  if (!canManageSchoolPlacement(actor, target)) {
    throw new AuthorizationError("이 사용자의 반·부서를 바꿀 권한이 없습니다.");
  }
}

// 반/부서(SchoolGroup) 생성·수정·삭제 권한. 학교 자체(School)의 생성·이름변경·삭제는 여전히
// SUPER_ADMIN 전용입니다(app/api/admin/schools/route.ts, [schoolId]/route.ts).
export function canManageSchoolGroups(actor: AuthorizationUser, schoolId: string) {
  if (actor.role === "SUPER_ADMIN") return true;
  if (actor.role === "ADMIN") return hasSystemPermission(actor, "CHANGE_NON_ADMIN_ROLES");
  return actor.role === "TEACHER" && actor.isSchoolRepresentative && actor.school?.id === schoolId;
}

export function assertCanManageSchoolGroups(actor: AuthorizationUser, schoolId: string) {
  if (!canManageSchoolGroups(actor, schoolId)) {
    throw new AuthorizationError("이 학교의 반·부서를 관리할 권한이 없습니다.");
  }
}

// 학생 여러 명의 반 이동은 출석번호 한 건 편집보다 영향 범위가 큽니다. 전체관리자,
// 관련 시스템 권한이 있는 보조관리자, 자기 학교 대표교사만 수행합니다.
export function canManageStudentClassMoves(actor: AuthorizationUser, schoolId: string) {
  if (actor.role === "SUPER_ADMIN") return true;
  if (actor.role === "ADMIN") return hasSystemPermission(actor, "CHANGE_NON_ADMIN_ROLES");
  return actor.role === "TEACHER" && actor.isSchoolRepresentative && actor.school?.id === schoolId;
}

export function assertCanManageStudentClassMoves(actor: AuthorizationUser, schoolId: string) {
  if (!canManageStudentClassMoves(actor, schoolId)) {
    throw new AuthorizationError("이 학교 학생의 반을 이동할 권한이 없습니다.");
  }
}

// 사용자·소속 화면의 명단 읽기는 전체관리자, 사용자 조회 권한이 있는 보조관리자, 그리고
// 자기 학교 교사에게 허용합니다. 반/부서 CRUD 권한과 분리해 일반 교사는 구조를 바꾸지 못합니다.
export function canViewSchoolMembers(actor: AuthorizationUser, schoolId: string) {
  if (actor.role === "SUPER_ADMIN") return true;
  if (actor.role === "ADMIN") return hasSystemPermission(actor, "VIEW_USERS");
  return actor.role === "TEACHER" && actor.school?.id === schoolId;
}

export function assertCanViewSchoolMembers(actor: AuthorizationUser, schoolId: string) {
  if (!canViewSchoolMembers(actor, schoolId)) {
    throw new AuthorizationError("이 학교의 구성원을 볼 권한이 없습니다.");
  }
}

// 출석번호는 역할·상태·학교 배치보다 좁은 학생 명단 필드입니다. 관리자는 사용자 조회 권한이
// 있을 때, 교사는 대표 여부와 관계없이 자기 학교 학생에 한해서만 지정·변경·해제할 수 있습니다.
export function canManageStudentNumber(
  actor: AuthorizationUser,
  target: { role: UserRole; schoolId: string | null },
) {
  if (target.role !== "STUDENT" || !target.schoolId) return false;
  if (actor.role === "SUPER_ADMIN") return true;
  if (actor.role === "ADMIN") return hasSystemPermission(actor, "VIEW_USERS");
  return actor.role === "TEACHER" && actor.school?.id === target.schoolId;
}

export function assertCanManageStudentNumber(
  actor: AuthorizationUser,
  target: { role: UserRole; schoolId: string | null },
) {
  if (!canManageStudentNumber(actor, target)) {
    throw new AuthorizationError("이 학생의 번호를 변경할 권한이 없습니다.");
  }
}

export function canReviewTeacherApproval(actor: AuthorizationUser, schoolId: string) {
  if (actor.role === "SUPER_ADMIN") return true;
  return actor.role === "TEACHER"
    && actor.isSchoolRepresentative
    && actor.school?.id === schoolId;
}

export function assertCanReviewTeacherApproval(actor: AuthorizationUser, schoolId: string) {
  if (!canReviewTeacherApproval(actor, schoolId)) {
    throw new AuthorizationError("이 학교의 교사 가입 요청을 처리할 권한이 없습니다.");
  }
}
