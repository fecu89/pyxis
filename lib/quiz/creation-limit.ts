import "server-only";

import type { UserRole } from "@/generated/prisma/client";
import { AuthorizationError } from "@/lib/auth/authorization";
import type { CurrentUser } from "@/lib/auth/current-user";
import { SYSTEM_SETTINGS_ID } from "@/lib/board/ownership-limit";
import { getPrisma } from "@/lib/prisma";

// quiz에서는 별도 AppPolicy 테이블이 상한을 들고 있었지만, 병합하면서 패드 상한과 같은
// SystemSetting 싱글턴으로 합쳤습니다(prisma/schema/identity.prisma). 행이 없으면 아래 기본값을
// 쓰고 생성은 관리 화면에서 저장할 때만 일어납니다 — 읽기만 하는 경로가 행을 만들지 않게.
const DEFAULT_STUDENT_QUIZ_LIMIT = 10;
const DEFAULT_TEACHER_QUIZ_LIMIT: number | null = null;

/**
 * 한 사람이 가질 수 있는 퀴즈 수를 제한합니다. 상한은 관리 콘솔의 정책 설정에서 바꾸고,
 * 비워 두면 무제한입니다(교사 기본값). 세는 대상은 살아 있는 퀴즈뿐이라 필요 없는 퀴즈를
 * 지우면 자리가 다시 생깁니다.
 *
 * 새로 만들거나 복제할 때만 검사합니다. 회원 삭제로 넘어오는 퀴즈 이관은 관리자의 정리
 * 작업이라 여기를 거치지 않습니다 — 이관 때문에 한도를 넘겨도 후임 교사가 벌을 받으면
 * 안 되고, 넘긴 상태에서 새로 만드는 것만 막히면 충분합니다.
 */
export async function requireQuizCreationCapacity(actor: CurrentUser) {
  const limit = await currentQuizLimit(actor.role);
  if (limit === null) return;

  // 조사가 붙는 자리라 "학생은/교사는"을 통째로 둡니다("학생는"이 되지 않게).
  const subject = actor.role === "STUDENT" ? "학생은" : "교사는";
  if (limit === 0) throw new AuthorizationError(`${subject} 현재 퀴즈를 만들 수 없도록 설정되어 있습니다.`);

  const count = await getPrisma().quiz.count({ where: { ownerId: actor.id, deletedAt: null } });
  if (count >= limit) {
    throw new AuthorizationError(`${subject} 퀴즈를 최대 ${limit}개까지 만들 수 있습니다. 쓰지 않는 퀴즈를 삭제한 뒤 다시 시도해 주세요.`);
  }
}

/** 화면에서 "3/10개" 같은 안내를 그리려면 상한 자체가 필요합니다. */
export async function currentQuizLimit(role: UserRole): Promise<number | null> {
  // 관리자에게는 한도를 두지 않습니다.
  if (role === "SUPER_ADMIN" || role === "ADMIN") return null;
  const row = await getPrisma().systemSetting.findUnique({
    where: { id: SYSTEM_SETTINGS_ID },
    select: { studentQuizLimit: true, teacherQuizLimit: true },
  });
  return role === "STUDENT"
    ? row?.studentQuizLimit ?? DEFAULT_STUDENT_QUIZ_LIMIT
    : row?.teacherQuizLimit ?? DEFAULT_TEACHER_QUIZ_LIMIT;
}
