import { createHash, randomBytes } from "node:crypto";
import { parse, serialize } from "cookie";

// 로그인 없이 응답하는 사람의 신원입니다. lib/quiz/guest-access.ts와 같은 방식이고, 다른 점은
// 세션이 아니라 **설문**마다 쿠키가 하나라는 것뿐입니다(설문에는 세션 계층이 없습니다).
//
// 토큰 원문은 DB에 넣지 않고 sha256만 저장합니다. DB가 새어도 남의 응답을 수정할 수 있는
// 열쇠가 함께 새지는 않게 하려는 것입니다.
//
// 이 쿠키가 있어야 하는 이유는 두 가지입니다 — ① 1인 1응답 설문에서 같은 사람인지 알아야 하고,
// ② `allowEditAfterSubmit`에서 자기 응답만 고칠 수 있어야 합니다. 둘 다 익명이라 계정으로는
// 판정할 수 없습니다. 물론 쿠키를 지우면 새 사람이 되는데, 그건 익명 설문의 원리적 한계라
// 여기서 막을 수 있는 것이 아닙니다(구글 설문지도 같습니다).

const GUEST_COOKIE_PREFIX = "form_guest_";
const GUEST_COOKIE_MAX_AGE = 60 * 60 * 24 * 90;

export function guestCookieName(formId: string) {
  return `${GUEST_COOKIE_PREFIX}${formId}`;
}

export function hashGuestToken(token: string) {
  return createHash("sha256").update(token).digest("hex");
}

export function createGuestToken() {
  return randomBytes(32).toString("base64url");
}

export function readGuestToken(request: Request, formId: string): string | null {
  return readGuestTokenFromCookieHeader(request.headers.get("cookie"), formId);
}

export function readGuestTokenFromCookieHeader(cookieHeader: string | null, formId: string): string | null {
  const values = parse(cookieHeader ?? "");
  return values[guestCookieName(formId)] ?? null;
}

/** 요청에 쿠키가 있으면 그 해시, 없으면 새 토큰을 만들어 둘 다 돌려줍니다. */
export function resolveGuestToken(request: Request, formId: string) {
  const existing = readGuestToken(request, formId);
  const token = existing ?? createGuestToken();
  return { token, tokenHash: hashGuestToken(token), isNew: !existing };
}

export function withGuestCookie(response: Response, formId: string, token: string) {
  response.headers.append(
    "Set-Cookie",
    serialize(guestCookieName(formId), token, {
      httpOnly: true,
      sameSite: "lax",
      secure: process.env.NEXTAUTH_URL
        ? process.env.NEXTAUTH_URL.startsWith("https://")
        : process.env.NODE_ENV === "production",
      path: "/",
      maxAge: GUEST_COOKIE_MAX_AGE,
    }),
  );
  return response;
}

/**
 * 1인 1응답을 DB가 막게 하는 열쇠입니다(FormResponse.dedupeKey).
 *
 * 복수 응답을 허용하면 null입니다 — PostgreSQL이 유니크 인덱스에서 null을 서로 다른 값으로
 * 보므로, 같은 제약 하나가 두 정책을 다 표현합니다. 자세한 이유는 prisma/schema/form.prisma의
 * dedupeKey 주석에 있습니다.
 */
export function dedupeKeyFor(input: {
  allowMultipleResponses: boolean;
  respondentId?: string | null;
  guestTokenHash?: string | null;
}): string | null {
  if (input.allowMultipleResponses) return null;
  if (input.respondentId) return `u:${input.respondentId}`;
  if (input.guestTokenHash) return `g:${input.guestTokenHash}`;
  return null;
}
