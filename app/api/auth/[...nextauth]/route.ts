import NextAuth from "next-auth";
import type { NextRequest } from "next/server";
import { serialize } from "cookie";
import { authOptions } from "@/lib/auth/auth-options";
import { SIGNUP_CONSENT_COOKIE, SIGNUP_CONSENT_COOKIE_PATH } from "@/lib/auth/signup-consent-cookie";

export const runtime = "nodejs";

const handler = NextAuth(authOptions);

async function authHandler(request: NextRequest, context: { params: Promise<{ nextauth: string[] }> }) {
  const response: Response = await handler(request, context);
  // Both successful and rejected callbacks consume the browser's signup intent.
  if (request.nextUrl.pathname === "/api/auth/callback/kakao") {
    response.headers.append("Set-Cookie", serialize(SIGNUP_CONSENT_COOKIE, "", {
      httpOnly: true, secure: process.env.NODE_ENV === "production", sameSite: "lax", path: SIGNUP_CONSENT_COOKIE_PATH, maxAge: 0,
    }));
  }
  return response;
}

export { authHandler as GET, authHandler as POST };
