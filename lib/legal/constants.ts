// Public service information, explicitly supplied by the operator. Never read this from private account credentials.
export const LEGAL_OPERATOR = "fecu";
export const PRIVACY_EMAIL = "fecu@kakao.com";
export const TERMS_VERSION = "2026-09-22";
export const PRIVACY_VERSION = "2026-09-22";

export type SignupConsent = { terms: boolean; privacy: boolean; age14: boolean; termsVersion: string; privacyVersion: string };
export function emptySignupConsent(): SignupConsent {
  return { terms: false, privacy: false, age14: false, termsVersion: TERMS_VERSION, privacyVersion: PRIVACY_VERSION };
}
export function hasSignupConsent(consent: SignupConsent) {
  return consent.terms === true && consent.privacy === true && consent.age14 === true
    && consent.termsVersion === TERMS_VERSION && consent.privacyVersion === PRIVACY_VERSION;
}
