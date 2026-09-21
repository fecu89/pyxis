import { createHash, randomBytes } from "node:crypto";
import { parse, serialize } from "cookie";
import { getPrisma } from "@/lib/prisma";

// Next Route Handler와 커스텀 Socket.IO 서버가 같이 불러오는 모듈이므로
// Next.js 전용 `server-only` 가드를 두지 않습니다. 클라이언트에서는 이 파일을 import하지 않습니다.

const GUEST_COOKIE_PREFIX = "quiz_guest_";
const GUEST_COOKIE_MAX_AGE = 60 * 60 * 24 * 14;

export function guestCookieName(sessionId: string) {
  return `${GUEST_COOKIE_PREFIX}${sessionId}`;
}

export function hashGuestToken(token: string) {
  return createHash("sha256").update(token).digest("hex");
}

export function createGuestToken() {
  return randomBytes(32).toString("base64url");
}

export function readGuestToken(request: Request, sessionId: string) {
  const values = parse(request.headers.get("cookie") ?? "");
  return values[guestCookieName(sessionId)] ?? null;
}

export async function findGuestParticipant(sessionId: string, token: string | null) {
  if (!token) return null;
  return getPrisma().sessionParticipant.findFirst({
    where: { sessionId, userId: null, guestTokenHash: hashGuestToken(token) },
  });
}

export async function requirePublicParticipation(request: Request, sessionId: string) {
  const session = await getPrisma().quizSession.findUnique({ where: { id: sessionId } });
  if (!session || session.requiresLogin) throw new Error("공개 세션을 찾을 수 없습니다.");
  const participant = await findGuestParticipant(sessionId, readGuestToken(request, sessionId));
  if (!participant) throw new Error("공개 참여 링크에서 닉네임을 입력해 주세요.");
  if (participant.status === "KICKED") throw new Error("호스트가 이 세션에서 내보냈습니다.");
  return { session, participant };
}

export function withGuestCookie(response: Response, sessionId: string, token: string) {
  response.headers.append("Set-Cookie", serialize(guestCookieName(sessionId), token, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NEXTAUTH_URL ? process.env.NEXTAUTH_URL.startsWith("https://") : process.env.NODE_ENV === "production",
    path: "/",
    maxAge: GUEST_COOKIE_MAX_AGE,
  }));
  return response;
}
