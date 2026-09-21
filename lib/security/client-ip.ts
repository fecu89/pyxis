import "server-only";

// 실제 구현은 proxy.ts(미들웨어)와 공유하기 위해 lib/security/request-identity.ts에 있습니다.
// 서버 전용 호출부는 계속 이 모듈을 통해 가져다 씁니다.
export { hasTrustedClientIp, rateLimitIdentity, trustedClientIdentifier } from "@/lib/security/request-identity";
