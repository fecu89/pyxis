// 미들웨어(proxy.ts)와 Route Handler가 함께 쓰는 요청 식별 로직입니다. lib/security/client-ip.ts와
// 달리 "server-only"를 붙이지 않는 이유는 proxy.ts가 react-server 조건 없이 평가될 수 있어서이며,
// 이 모듈은 요청 헤더만 읽고 DB·파일·비밀키에 접근하지 않으므로 그렇게 해도 안전합니다.

type HeaderValue = string | string[] | undefined;
type HeaderSource = Headers | Record<string, HeaderValue> | undefined;

function headerValue(headers: HeaderSource, name: string) {
  if (!headers) return null;
  if (headers instanceof Headers) return headers.get(name);
  const value = headers[name] ?? headers[name.toLowerCase()];
  return Array.isArray(value) ? value.at(-1) ?? null : value ?? null;
}

function lastForwardedHop(value: string | null) {
  return value?.split(",").map((part) => part.trim()).filter(Boolean).at(-1) ?? null;
}

// 클라이언트가 임의로 넣은 IP 헤더를 신뢰하면 제한 키를 매 요청 바꿀 수 있습니다. Vercel은
// 자체 헤더만, Cloudflare/리버스 프록시는 원본 서버가 해당 프록시에서만 접근 가능하도록 잠근
// 배포에서 명시적 환경 변수를 켰을 때만 신뢰합니다. 알 수 없으면 하나의 보수적 버킷으로 묶습니다.
export function trustedClientIdentifier(headers: HeaderSource) {
  if (process.env.VERCEL === "1") {
    return lastForwardedHop(headerValue(headers, "x-vercel-forwarded-for"))
      ?? lastForwardedHop(headerValue(headers, "x-forwarded-for"))
      ?? "unknown";
  }
  if (process.env.TRUST_CLOUDFLARE_IP_HEADER === "true") {
    return headerValue(headers, "cf-connecting-ip")?.trim() || "unknown";
  }
  if (process.env.TRUST_X_FORWARDED_FOR === "true") {
    return lastForwardedHop(headerValue(headers, "x-forwarded-for")) ?? "unknown";
  }
  if (process.env.NODE_ENV !== "production") {
    return lastForwardedHop(headerValue(headers, "x-forwarded-for")) ?? "local-development";
  }
  return "unknown";
}

// 신뢰할 수 있는 IP를 실제로 얻을 수 있는 배포인지. false면 모든 익명 요청이 "unknown"이라는
// 하나의 버킷으로 묶이므로, IP 기준 차단을 그대로 적용하면 공격자 한 명이 전체 익명 사용자를
// 함께 막아버리는 자기 DoS가 됩니다. 그래서 익명 제한은 이 값이 true일 때만 강제합니다.
export function hasTrustedClientIp() {
  return process.env.VERCEL === "1"
    || process.env.TRUST_CLOUDFLARE_IP_HEADER === "true"
    || process.env.TRUST_X_FORWARDED_FOR === "true"
    || process.env.NODE_ENV !== "production";
}

// 제한 키: 로그인 사용자는 계정 단위(정확하고 NAT 뒤 공유 IP의 영향을 받지 않음), 비로그인은
// 신뢰 가능한 IP가 있을 때만 IP 단위. 둘 다 없으면 null을 돌려 호출부가 IP 제한을 건너뜁니다.
export function rateLimitIdentity(headers: HeaderSource, userId: string | null) {
  if (userId) return `u:${userId}`;
  if (!hasTrustedClientIp()) return null;
  return `ip:${trustedClientIdentifier(headers)}`;
}
