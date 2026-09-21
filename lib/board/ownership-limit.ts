import "server-only";

import type { Prisma, UserRole } from "@/generated/prisma/client";
import { getPrisma } from "@/lib/prisma";

export const SYSTEM_SETTINGS_ID = "default";
const DEFAULT_STUDENT_BOARD_LIMIT = 10;
const DEFAULT_TEACHER_BOARD_LIMIT = 40;

const ROLE_LABELS: Record<UserRole, string> = {
  SUPER_ADMIN: "전체관리자",
  ADMIN: "보조관리자",
  TEACHER: "교사",
  STUDENT: "학생",
};

export function roleLabelFor(role: UserRole): string {
  return ROLE_LABELS[role];
}

export class BoardOwnershipLimitError extends Error {
  readonly status = 409;

  constructor(role: UserRole, limit: number) {
    super(`${ROLE_LABELS[role]} 계정은 패드를 최대 ${limit}개까지 소유할 수 있습니다. 보관함의 패드를 정리하거나 소유권을 이전한 뒤 다시 시도해 주세요.`);
    this.name = "BoardOwnershipLimitError";
  }
}

type SettingsClient = Prisma.TransactionClient | ReturnType<typeof getPrisma>;

// 학생·교사가 소유할 수 있는 최대 패드 개수입니다. 예전에는 코드 상수였지만, 전체관리자가
// 관리 페이지("설정" 탭)에서 직접 조정할 수 있도록 SystemSetting 싱글턴 행으로 옮겼습니다.
// 행이 아직 없으면(최초 배포 직후, 마이그레이션만 적용되고 아무도 저장한 적 없는 상태) 기존
// 기본값으로 동작합니다.
export async function getBoardOwnershipLimits(client: SettingsClient = getPrisma()) {
  const row = await client.systemSetting.findUnique({
    where: { id: SYSTEM_SETTINGS_ID },
    select: { studentBoardLimit: true, teacherBoardLimit: true },
  });
  return {
    STUDENT: row?.studentBoardLimit ?? DEFAULT_STUDENT_BOARD_LIMIT,
    TEACHER: row?.teacherBoardLimit ?? DEFAULT_TEACHER_BOARD_LIMIT,
  };
}

export async function boardOwnershipLimitFor(role: UserRole, client: SettingsClient = getPrisma()): Promise<number | null> {
  if (role !== "STUDENT" && role !== "TEACHER") return null;
  const limits = await getBoardOwnershipLimits(client);
  return limits[role];
}

/**
 * 한 사용자의 "한도 확인 → 패드 생성/이전"을 같은 트랜잭션에서 직렬화합니다.
 * 단순 count 후 create만 하면 동시에 들어온 두 요청이 모두 한도 미만으로 판단할 수 있으므로,
 * 사용자 ID 기반 PostgreSQL advisory transaction lock을 먼저 얻습니다.
 */
export async function assertCanOwnAnotherBoard(
  tx: Prisma.TransactionClient,
  user: { id: string; role: UserRole },
) {
  const limit = await boardOwnershipLimitFor(user.role, tx);
  if (limit === null) return;
  await tx.$queryRaw<Array<{ locked: string }>>`
    SELECT pg_advisory_xact_lock(hashtextextended(${user.id}, 20260802))::text AS locked
  `;
  const ownedBoardCount = await tx.board.count({ where: { ownerId: user.id } });
  if (ownedBoardCount >= limit) throw new BoardOwnershipLimitError(user.role, limit);
}
