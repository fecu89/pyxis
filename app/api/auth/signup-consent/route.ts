import { NextResponse } from "next/server";
import { signupConsentSchema } from "@/lib/auth/signup-consent";
import { createSignupConsentTicket, SIGNUP_CONSENT_COOKIE, SIGNUP_CONSENT_COOKIE_PATH, SIGNUP_CONSENT_MAX_AGE } from "@/lib/auth/signup-consent-cookie";
import { apiError, assertSameOrigin } from "@/lib/http";
import { readJsonWithLimit } from "@/lib/http-json";

export async function POST(request: Request) {
  try {
    assertSameOrigin(request);
    const parsed = signupConsentSchema.safeParse(await readJsonWithLimit(request, 4096));
    if (!parsed.success) return NextResponse.json({ error: "필수 동의 항목과 만 14세 이상 확인을 완료해 주세요." }, { status: 400, headers: { "Cache-Control": "no-store" } });
    const ticket = await createSignupConsentTicket(parsed.data);
    const response = NextResponse.json({ ok: true }, { headers: { "Cache-Control": "no-store" } });
    response.cookies.set(SIGNUP_CONSENT_COOKIE, ticket, {
      httpOnly: true, secure: process.env.NODE_ENV === "production", sameSite: "lax", path: SIGNUP_CONSENT_COOKIE_PATH, maxAge: SIGNUP_CONSENT_MAX_AGE,
    });
    return response;
  } catch (error) { return apiError(error, "가입 동의를 확인하지 못했습니다."); }
}

export async function DELETE(request: Request) {
  try {
    assertSameOrigin(request);
    const response = NextResponse.json({ ok: true }, { headers: { "Cache-Control": "no-store" } });
    response.cookies.set(SIGNUP_CONSENT_COOKIE, "", { httpOnly: true, secure: process.env.NODE_ENV === "production", sameSite: "lax", path: SIGNUP_CONSENT_COOKIE_PATH, maxAge: 0 });
    return response;
  } catch (error) { return apiError(error, "이전 가입 동의를 정리하지 못했습니다."); }
}
