// 교사 간 콘텐츠 공유(퀴즈·설문)의 대상 범위 판정.
//
// 위치가 lib/users인 이유: 이 판정은 quiz·forms 어느 한 도메인의 규칙이 아니라 "사용자 후보를
// 어디까지 노출할지"라는 사용자 범위 규칙이기 때문입니다. quiz 공유 라우트와 `lib/forms/shares.ts`가
// 같은 함수를 써야 후보 목록(GET)과 대상 검증(POST)이 갈라지지 않습니다(api-design 규칙 —
// 라우트와 페이지는 lib의 같은 로더). `lib/board/member-candidates.ts`의
// `boardMemberCandidateScope`와 같은 판정 방식입니다.
//
// `lib/auth/permissions.ts`처럼 DB·세션에 의존하지 않는 순수 판정만 두므로 `server-only`를
// 붙이지 않습니다 — verify 스크립트가 부분 조회한 값으로도 그대로 부를 수 있습니다.

import type { Prisma } from "@/generated/prisma/client";
import { hasSystemPermission, type PermissionHolder } from "@/lib/auth/permissions";

// `CurrentUser` 전체 대신 판정에 실제로 쓰는 필드만 받습니다(`PermissionHolder`와 같은 이유).
// `CurrentUser`는 이 타입을 구조적으로 만족하므로 라우트에서는 그대로 넘기면 됩니다.
export type ShareScopeActor = PermissionHolder & { school?: { id: string } | null };

/**
 * 공유 후보 교사의 범위. 후보 목록이 검색형 리스트 UI가 되며 노출 표면이 넓어지지 않도록
 * 전 플랫폼이 아니라 같은 학교로 좁힙니다 — VIEW_USERS 권한이 있으면 전체, 아니면 내 학교,
 * 소속이 없으면 후보 없음. 이미 공유된 대상(`shares`)은 이 범위와 무관하게 그대로 내려주고
 * 권한 변경(업서트)도 허용합니다 — 후보 축소 이전에 맺어진 학교 밖 공유가 막히면 안 됩니다.
 */
export function teacherShareCandidateScope(actor: ShareScopeActor): Prisma.UserWhereInput {
  if (hasSystemPermission(actor, "VIEW_USERS")) return {};
  if (actor.school) return { schoolId: actor.school.id };
  // 소속 학교가 없는 교사는 공유 후보를 특정할 수 없습니다. 빈 결과가 나오도록 둡니다.
  return { id: "__no_school__" };
}
