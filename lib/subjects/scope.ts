import "server-only";

import type { Prisma } from "@/generated/prisma/client";
import type { CurrentUser } from "@/lib/auth/current-user";
import { hasSystemPermission } from "@/lib/auth/authorization";

/**
 * 교과목이 다룰 수 있는 학생·학급의 범위입니다. `course-dashboard.ts`에 있던 것을 여기로
 * 옮겼습니다 — 명단(roster.ts), 후보 조회, 변경 API가 모두 같은 판정을 써야 하는데
 * 대시보드 조회 모듈에 들어 있으면 서로를 import하다 순환이 생깁니다.
 */

export function canAssignStudentsToCourses(user: Pick<CurrentUser, "role">) {
  return user.role === "SUPER_ADMIN" || user.role === "ADMIN" || user.role === "TEACHER";
}

type ScopeUser = Pick<CurrentUser, "role" | "school" | "systemPermissions">;

/**
 * 학교 경계. 전체 사용자 조회 권한이 있는 관리자는 모든 학교, 일반 교사는 자기 학교만
 * 다룹니다. 소속이 없으면 아무도 못 고르도록 절대 매칭되지 않는 조건을 돌려줍니다.
 */
export function courseScopeSchoolId(user: ScopeUser): string | null {
  if (user.role === "SUPER_ADMIN" || hasSystemPermission(user, "VIEW_USERS")) return null;
  return user.school?.id ?? "__no_school__";
}

/** 퀴즈 할당과 같은 학교 경계를 씁니다. */
export function eligibleCourseStudentWhere(user: ScopeUser): Prisma.UserWhereInput {
  const schoolId = courseScopeSchoolId(user);
  if (schoolId === null) return {};
  if (schoolId === "__no_school__") return { id: "__no_school__" };
  return { schoolId };
}
