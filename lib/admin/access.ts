import "server-only";

import { redirect } from "next/navigation";
import type { AdminActor, AdminTab } from "@/components/admin/types";
import { ADMIN_SECTION_PATHS } from "@/lib/admin/navigation";
import {
  canAccessAdminShell,
  canManageSchoolGroups,
  canViewAllQuizzes,
  canViewSchoolDirectory,
  hasSystemPermission,
} from "@/lib/auth/authorization";
import { getCurrentUser, type CurrentUser } from "@/lib/auth/current-user";
import { redirectToLogin } from "@/lib/auth/page-guard";

export type AdminCapabilities = {
  canViewUsers: boolean;
  canViewSchools: boolean;
  canManageSchoolGroups: boolean;
  canManageRoster: boolean;
  canViewAudit: boolean;
  canManageTeacherApprovals: boolean;
  canManageSystemSettings: boolean;
  canViewAllBoards: boolean;
  canViewAllQuizzes: boolean;
  canViewAllForms: boolean;
};

export { ADMIN_SECTION_PATHS } from "@/lib/admin/navigation";

export function getAdminCapabilities(user: CurrentUser): AdminCapabilities {
  const isSchoolTeacher = user.role === "TEACHER" && user.school !== null;
  const isSchoolRepresentative = user.role === "TEACHER" && user.isSchoolRepresentative;
  const quizAccess = canViewAllQuizzes(user);
  return {
    canViewUsers: hasSystemPermission(user, "VIEW_USERS") || isSchoolTeacher,
    canViewSchools: canViewSchoolDirectory(user),
    canManageSchoolGroups: canManageSchoolGroups(user),
    canManageRoster: user.role === "SUPER_ADMIN" || isSchoolRepresentative,
    canViewAudit: hasSystemPermission(user, "VIEW_AUDIT_LOG"),
    canManageTeacherApprovals: user.role === "SUPER_ADMIN" || isSchoolRepresentative,
    canManageSystemSettings: user.role === "SUPER_ADMIN",
    canViewAllBoards: hasSystemPermission(user, "VIEW_ALL_BOARDS"),
    canViewAllQuizzes: quizAccess,
    // 설문은 현재 퀴즈의 전체 조회 권한을 함께 사용합니다(lib/forms/list.ts와 동일).
    canViewAllForms: quizAccess,
  };
}

export function canAccessAdminSection(section: AdminTab, access: AdminCapabilities) {
  if (section === "dashboard" || section === "schools") return access.canViewSchools;
  if (section === "users") return access.canViewUsers;
  if (section === "approvals") return access.canManageTeacherApprovals;
  if (section === "roster") return access.canManageRoster;
  if (section === "audit") return access.canViewAudit;
  if (section === "settings" || section === "audio" || section === "theme") return access.canManageSystemSettings;
  if (section === "boards") return access.canViewAllBoards;
  if (section === "quizzes") return access.canViewAllQuizzes;
  return access.canViewAllForms;
}

export function firstAdminPath(access: AdminCapabilities) {
  const order: AdminTab[] = ["dashboard", "users", "approvals", "audit", "schools", "roster", "boards", "quizzes", "forms", "settings", "audio", "theme"];
  const section = order.find((candidate) => canAccessAdminSection(candidate, access));
  return section ? ADMIN_SECTION_PATHS[section] : "/dashboard";
}

export function toAdminActor(user: CurrentUser): AdminActor {
  return {
    id: user.id,
    name: user.name,
    role: user.role,
    systemPermissions: user.systemPermissions,
    school: user.school,
    isSchoolRepresentative: user.isSchoolRepresentative,
  };
}

export async function getAdminSectionContext(section: AdminTab) {
  const path = ADMIN_SECTION_PATHS[section];
  const user = await getCurrentUser();
  if (!user) redirectToLogin(path);
  if (!canAccessAdminShell(user)) return null;
  const access = getAdminCapabilities(user);
  if (!canAccessAdminSection(section, access)) redirect(firstAdminPath(access));
  return {
    user,
    actor: toAdminActor(user),
    access,
    scopedSchoolId: user.role === "TEACHER" ? user.school?.id ?? null : null,
  };
}
