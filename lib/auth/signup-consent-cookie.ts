import "server-only";
import { cookies } from "next/headers";
import { encode, decode } from "next-auth/jwt";
import { signupConsentSchema } from "@/lib/auth/signup-consent";
import { safeInternalCallbackUrl } from "@/lib/auth/callback-url";
import type { SignupConsent } from "@/lib/legal/constants";

export const SIGNUP_CONSENT_COOKIE = "pyxis-signup-consent";
export { AUTH_API_COOKIE_PATH as SIGNUP_CONSENT_COOKIE_PATH } from "@/lib/routes";
export const SIGNUP_CONSENT_MAX_AGE = 15 * 60;
const salt = "pyxis-signup-consent-v1";

export async function createSignupConsentTicket(consent: SignupConsent) {
  const secret = process.env.AUTH_SECRET;
  if (!secret) throw new Error("가입 동의 설정을 확인해 주세요.");
  const verified = signupConsentSchema.parse(consent);
  return encode({ secret, salt, maxAge: SIGNUP_CONSENT_MAX_AGE, token: {
    purpose: "signup-consent", consent: verified, acceptedAt: Date.now(),
  } });
}

export async function readSignupConsent() {
  const value = (await cookies()).get(SIGNUP_CONSENT_COOKIE)?.value;
  const secret = process.env.AUTH_SECRET;
  if (!value || !secret) return null;
  try {
    const token = await decode({ token: value, secret, salt });
    if (token?.purpose !== "signup-consent" || !signupConsentSchema.safeParse(token.consent).success) return null;
    const acceptedAt = token.acceptedAt;
    if (typeof acceptedAt !== "number" || !Number.isFinite(acceptedAt)
      || acceptedAt > Date.now() || Date.now() - acceptedAt > SIGNUP_CONSENT_MAX_AGE * 1000) return null;
    return new Date(acceptedAt);
  } catch { return null; }
}

export async function signupConsentRedirect() {
  const jar = await cookies();
  const callback = jar.get("__Secure-next-auth.callback-url")?.value ?? jar.get("next-auth.callback-url")?.value;
  let internal = safeInternalCallbackUrl(callback, "/dashboard");
  // NextAuth stores absolute callback URLs. Accept only configured service origins,
  // never a Host/forwarded header supplied by the caller.
  if (callback && !callback.startsWith("/")) {
    try {
      const url = new URL(callback);
      const origins = [...(process.env.APP_ORIGINS?.split(",") ?? []), process.env.NEXTAUTH_URL]
        .filter((origin): origin is string => Boolean(origin?.trim()));
      if (origins.some(origin => new URL(origin.trim()).origin === url.origin)) {
        internal = safeInternalCallbackUrl(url.pathname + url.search + url.hash, "/dashboard");
      }
    } catch { /* Ignore a malformed or external callback. */ }
  }
  return `/login?signup=required&callbackUrl=${encodeURIComponent(internal)}`;
}
