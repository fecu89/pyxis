import "server-only";
import { z } from "zod";
import { PRIVACY_VERSION, TERMS_VERSION } from "@/lib/legal/constants";

export const signupConsentSchema = z.object({
  terms: z.literal(true, { error: "이용약관에 동의해 주세요." }),
  privacy: z.literal(true, { error: "개인정보 수집·이용에 동의해 주세요." }),
  age14: z.literal(true, { error: "만 14세 이상인지 확인해 주세요." }),
  termsVersion: z.literal(TERMS_VERSION, { error: "최신 이용약관을 확인해 주세요." }),
  privacyVersion: z.literal(PRIVACY_VERSION, { error: "최신 개인정보 처리방침을 확인해 주세요." }),
}, { error: "가입 약관과 개인정보 수집·이용 동의, 만 14세 이상 확인이 필요합니다." });

// Call only after validating the request or the authenticated OAuth consent ticket.
export function signupConsentData(acceptedAt = new Date()) {
  return { registrationConsentAt: acceptedAt, termsVersion: TERMS_VERSION, privacyVersion: PRIVACY_VERSION, age14Confirmed: true };
}
