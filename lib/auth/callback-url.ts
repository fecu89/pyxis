const CALLBACK_BASE_URL = "https://pyxcourse.local";

// 외부 출처·프로토콜 상대 URL·백슬래시 우회는 거부하고 앱 내부 경로만 OAuth 이후
// 목적지로 허용합니다. 브라우저의 공개 랜딩에서도 써야 하므로 server-only 모듈과 분리했습니다.
export function safeInternalCallbackUrl(
  value: string | string[] | undefined,
  fallback = "/",
): string {
  const candidate = Array.isArray(value) ? value[0] : value;
  if (!candidate || !candidate.startsWith("/") || candidate.startsWith("//") || candidate.includes("\\")) {
    return fallback;
  }

  try {
    const callbackUrl = new URL(candidate, CALLBACK_BASE_URL);
    if (callbackUrl.origin !== CALLBACK_BASE_URL) return fallback;
    return callbackUrl.pathname + callbackUrl.search + callbackUrl.hash;
  } catch {
    return fallback;
  }
}
