import "server-only";

import { createHash, randomBytes } from "node:crypto";

// padupgrade.md 5.2: 토큰 원문은 DB에 저장하지 않고, 생성 시 응답으로 1회만 내려줍니다.
// 조회·검증은 항상 해시값으로만 수행합니다.
export function generateInviteToken() {
  return randomBytes(24).toString("base64url");
}

export function hashInviteToken(token: string) {
  return createHash("sha256").update(token).digest("hex");
}
