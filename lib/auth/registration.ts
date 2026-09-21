import "server-only";

import { getPrisma } from "@/lib/prisma";
import { createLoginIdentifierLookup, normalizeLoginIdentifier } from "@/lib/security/pii-crypto";

const RESERVED_LOGIN_IDS = new Set([
  "admin", "administrator", "root", "system", "support", "help", "pyx", "pyxpad", "pyxcourse",
  "kakao", "teacher", "student", "school", "deleted", "null", "undefined",
]);

export async function registrationLoginIdAvailability(loginId: string) {
  const normalized = normalizeLoginIdentifier(loginId);
  const loginIdentifierLookup = createLoginIdentifierLookup(normalized);
  // 서비스 운영에 쓰이는 시스템 명칭만 일반 가입자가 먼저 차지하지 못하게 예약합니다.
  if (RESERVED_LOGIN_IDS.has(normalized)) {
    return { available: false, normalized, loginIdentifierLookup, reserved: true } as const;
  }
  const existing = await getPrisma().user.findUnique({ where: { loginIdentifierLookup }, select: { id: true } });
  return { available: !existing, normalized, loginIdentifierLookup, reserved: false } as const;
}
