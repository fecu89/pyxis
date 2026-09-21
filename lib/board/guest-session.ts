import "server-only";

import { createHmac, randomUUID, timingSafeEqual } from "node:crypto";
import { cookies } from "next/headers";

/**
 * 비로그인 손님이 공개 보드에 글을 쓸 때 쓰는 세션입니다.
 *
 * **DB 테이블을 두지 않습니다.** 보드 비밀번호 쿠키(lib/board/board-password.ts)와 같은 방식으로
 * 서명한 값을 HttpOnly 쿠키에 담습니다. 손님 세션은 "이 보드에서 방금 글을 쓴 사람이 나와 같은
 * 브라우저인가"만 판정하면 되고, 그건 서명만으로 충분합니다. 테이블을 두면 요청마다 조회가
 * 붙고 만료 세션을 치우는 작업까지 생기는데, 얻는 게 없습니다.
 *
 * 쿠키는 **보드마다 따로**입니다. 한 보드의 손님 신분이 다른 보드로 새지 않게 boardId를 서명에
 * 넣고 쿠키 이름도 분리합니다.
 *
 * 이 세션이 하는 일은 딱 둘입니다.
 *  ① 표시 이름을 기억해 매번 다시 묻지 않는다
 *  ② 자기가 쓴 글만 고치고 지울 수 있게 한다
 * **권한 자체는 여기서 나오지 않습니다.** 글을 쓸 수 있는지는 언제나 보드 설정(공개 범위·방문자
 * 권한)을 서버가 다시 읽어 판정합니다 — 쿠키를 위조해도 권한이 생기지 않습니다.
 */

const GUEST_TTL_SECONDS = 60 * 60 * 24 * 30;
export const GUEST_NAME_MAX = 20;

export type GuestSession = { guestId: string; name: string };

function requireAuthSecret() {
  const value = process.env.AUTH_SECRET;
  if (!value) throw new Error("AUTH_SECRET 환경 변수가 필요합니다.");
  return value;
}

const cookieName = (boardId: string) => `bgs_${boardId}`;

function sign(boardId: string, payload: string) {
  return createHmac("sha256", requireAuthSecret()).update(`${boardId}.${payload}`).digest("base64url");
}

function safeEqual(left: string, right: string) {
  const a = Buffer.from(left);
  const b = Buffer.from(right);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

/** 표시 이름 정리. 제어문자·과한 공백을 없애고 길이를 자릅니다. */
export function cleanGuestName(raw: string): string {
  return raw
    // 제어문자는 이름에 들어올 이유가 없습니다.
    .replace(/[\x00-\x1f\x7f]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, GUEST_NAME_MAX);
}

/**
 * 손님 세션을 발급합니다. 이미 있으면 guestId는 유지하고 이름만 갱신합니다 — 이름을 바꿨다고
 * 지금까지 쓴 글의 소유권을 잃으면 안 됩니다.
 */
export async function issueGuestSession(boardId: string, name: string): Promise<GuestSession> {
  const existing = await readGuestSession(boardId);
  const session: GuestSession = { guestId: existing?.guestId ?? randomUUID(), name: cleanGuestName(name) };
  const payload = Buffer.from(JSON.stringify(session), "utf8").toString("base64url");
  const store = await cookies();
  store.set(cookieName(boardId), `${payload}.${sign(boardId, payload)}`, {
    httpOnly: true,
    sameSite: "lax",
    path: "/",
    secure: process.env.NODE_ENV === "production",
    maxAge: GUEST_TTL_SECONDS,
  });
  return session;
}

/** 쿠키에서 손님 세션을 읽습니다. 서명이 안 맞으면 없는 것으로 봅니다. */
export async function readGuestSession(boardId: string): Promise<GuestSession | null> {
  const raw = (await cookies()).get(cookieName(boardId))?.value;
  if (!raw) return null;
  const separator = raw.lastIndexOf(".");
  if (separator <= 0) return null;
  const payload = raw.slice(0, separator);
  const signature = raw.slice(separator + 1);
  if (!safeEqual(signature, sign(boardId, payload))) return null;
  try {
    const parsed = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as Partial<GuestSession>;
    if (typeof parsed.guestId !== "string" || typeof parsed.name !== "string") return null;
    return { guestId: parsed.guestId, name: parsed.name };
  } catch {
    return null;
  }
}
