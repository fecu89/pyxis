import "server-only";

import { createHmac, randomBytes, scrypt, timingSafeEqual } from "node:crypto";
import { cookies } from "next/headers";
import { decryptBoardPasswordSecret, encryptBoardPasswordSecret } from "@/lib/security/pii-crypto-core";
import { runBoundedCryptoWork } from "@/lib/security/crypto-work-queue";

export { decryptBoardPasswordSecret, encryptBoardPasswordSecret };

// 방문자 검증은 salt+scrypt 해시를 사용합니다. 소유자에게 다시 보여 줄 암호화본은
// pii-crypto-core의 AES-GCM 함수로 별도 관리하고, 이 해시를 복호화하려고 하지 않습니다.
function deriveBoardPassword(password: string, salt: string) {
  return runBoundedCryptoWork(() => new Promise<Buffer>((resolve, reject) => {
    scrypt(password, salt, 64, (error, derivedKey) => {
      if (error) reject(error);
      else resolve(derivedKey);
    });
  }));
}

export async function hashBoardPassword(password: string) {
  const salt = randomBytes(16).toString("hex");
  const derived = (await deriveBoardPassword(password, salt)).toString("hex");
  return `${salt}:${derived}`;
}

export async function verifyBoardPassword(password: string, storedHash: string) {
  const [salt, derivedHex] = storedHash.split(":");
  if (!salt || !derivedHex) return false;
  const derived = await deriveBoardPassword(password, salt);
  const stored = Buffer.from(derivedHex, "hex");
  if (derived.length !== stored.length) return false;
  return timingSafeEqual(derived, stored);
}

function requireAuthSecret() {
  const value = process.env.AUTH_SECRET;
  if (!value) throw new Error("AUTH_SECRET 환경 변수가 필요합니다.");
  return value;
}

export function createBoardPasswordVerificationSignature(boardId: string, passwordHash: string) {
  return createHmac("sha256", requireAuthSecret())
    .update(boardId)
    .update("\0")
    .update(passwordHash)
    .digest("hex");
}

const cookieName = (boardId: string) => `bpv_${boardId}`;
const PASSWORD_CLIENT_COOKIE = "bp_client";

export async function getBoardPasswordClientId() {
  const store = await cookies();
  const current = store.get(PASSWORD_CLIENT_COOKIE)?.value;
  if (current && /^[A-Za-z0-9_-]{24}$/.test(current)) return current;

  const created = randomBytes(18).toString("base64url");
  store.set(PASSWORD_CLIENT_COOKIE, created, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 60 * 60 * 24 * 365,
  });
  return created;
}

// 비밀번호를 맞힌 방문자에게 그 보드 하나에만 유효한 서명 쿠키를 내려줍니다. 세션/DB 없이도
// 위조할 수 없고(HMAC), 다른 보드나 비밀번호 변경 뒤에는 재사용할 수 없습니다(보드 ID와 현재 해시로 서명).
export async function markBoardPasswordVerified(boardId: string, passwordHash: string) {
  const store = await cookies();
  store.set(cookieName(boardId), createBoardPasswordVerificationSignature(boardId, passwordHash), {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 60 * 60 * 24 * 7,
  });
}

export async function hasVerifiedBoardPassword(boardId: string, passwordHash: string) {
  const store = await cookies();
  const value = store.get(cookieName(boardId))?.value;
  if (!value) return false;
  const expected = createBoardPasswordVerificationSignature(boardId, passwordHash);
  const a = Buffer.from(value);
  const b = Buffer.from(expected);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}
