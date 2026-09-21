// 권한 판정의 순수 함수만 모은 모듈입니다.
//
// `lib/auth/authorization.ts`는 `import "server-only"`라서 커스텀 Socket.IO 서버(`server.ts`,
// 순수 Node 런타임)에서 가져오면 모듈 로드 시점에 터집니다. 두 런타임이 같은 규칙을 쓰도록
// DB·세션에 의존하지 않는 판정만 여기로 분리했습니다. `authorization.ts`는 이 모듈을 다시
// 내보내므로 기존 호출부는 그대로 둡니다.

import type { SystemPermission } from "@/generated/prisma/enums";

// 판정에 실제로 필요한 필드만 받습니다. `CurrentUser` 전체를 요구하면 소켓 핸드셰이크 결과처럼
// 부분 조회한 값으로는 판정할 수 없게 됩니다.
export type PermissionHolder = {
  role: "SUPER_ADMIN" | "ADMIN" | "TEACHER" | "STUDENT";
  systemPermissions: SystemPermission[];
};

/**
 * SUPER_ADMIN은 목록과 무관하게 전부 허용하고, ADMIN은 개별 부여된 권한만 허용합니다.
 * TEACHER 이하에게는 시스템 권한을 부여하지 않으므로 항상 false입니다.
 */
export function hasSystemPermission(user: PermissionHolder, permission: SystemPermission) {
  return user.role === "SUPER_ADMIN"
    || (user.role === "ADMIN" && user.systemPermissions.includes(permission));
}

/** 남의 퀴즈까지 목록·상세로 볼 수 있는지. 수정 권한이 있으면 조회도 당연히 됩니다. */
export function canViewAllQuizzes(user: PermissionHolder) {
  return hasSystemPermission(user, "VIEW_ALL_QUIZZES") || hasSystemPermission(user, "EDIT_ANY_QUIZ");
}

/** 내가 열지 않은 세션까지 목록·진행·리포트로 다룰 수 있는지. */
export function canManageAnySession(user: PermissionHolder) {
  return hasSystemPermission(user, "MANAGE_ANY_SESSION");
}

/**
 * 학생의 활동 리포트를 볼 수 있는지.
 *
 * `canManageStudent`(authorization.ts)와 일부러 다릅니다. 저건 계정 발급·비밀번호 재설정 권한이라
 * 대표교사나 ISSUE_STUDENT_ACCOUNTS 보유자만 통과하는데, 리포트는 **같은 학교 교사면 볼 수 있어야**
 * 합니다. 자기 반 학생의 활동을 보려고 계정 발급 권한을 받아야 하는 건 말이 안 됩니다.
 *
 * 범위는 `lib/activity/report.ts`의 `scopeFor`와 같습니다 — 목록에서 보이는 학생은 상세도 열려야
 * 하고, 그 반대도 마찬가지입니다.
 */
export function canViewStudentReport(
  actor: PermissionHolder & { id: string; school?: { id: string } | null },
  student: { id: string; schoolId: string | null },
) {
  if (actor.id === student.id) return true;
  if (actor.role === "SUPER_ADMIN"
    || hasSystemPermission(actor, "VIEW_ALL_QUIZZES")
    || hasSystemPermission(actor, "VIEW_ALL_BOARDS")) return true;
  if (actor.role === "TEACHER" && actor.school) return actor.school.id === student.schoolId;
  return false;
}
