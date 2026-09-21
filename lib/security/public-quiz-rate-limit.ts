import "server-only";

import { getPlatformSecurityPolicy } from "@/lib/security/platform-policy";
import { assertRateLimit } from "@/lib/security/rate-limit";

const INVALID_PIN_ATTEMPTS_PER_MINUTE = 20;

export async function assertPublicQuizJoinRateLimit(request: Request) {
  const policy = await getPlatformSecurityPolicy();
  assertRateLimit(request, {
    scope: "public-quiz-join",
    windowMs: 60_000,
    maxAttempts: policy.publicQuizJoinPerMinute,
    message: "공개 퀴즈 참여 요청이 너무 잦습니다. 잠시 후 다시 시도해 주세요.",
  });
}

/**
 * 정상 PIN으로 한 반이 동시에 들어오는 트래픽과 PIN 전수 대입을 같은 IP 버킷으로 세지 않습니다.
 * 모든 요청은 위의 넉넉한 교실 상한을 먼저 받고, 세션을 찾지 못한 요청만 이 좁은 실패 상한을
 * 추가로 소비합니다. 학교 NAT 뒤 정상 학생들은 실패 버킷을 건드리지 않습니다.
 */
export function assertPublicQuizInvalidPinRateLimit(request: Request) {
  assertRateLimit(request, {
    scope: "public-quiz-invalid-pin",
    windowMs: 60_000,
    maxAttempts: INVALID_PIN_ATTEMPTS_PER_MINUTE,
    message: "PIN 확인 요청이 너무 잦습니다. 잠시 후 다시 시도해 주세요.",
  });
}

export async function assertPublicQuizApiRateLimit(request: Request, participantId: string) {
  const policy = await getPlatformSecurityPolicy();
  assertRateLimit(request, {
    scope: "public-quiz-api",
    userId: `guest:${participantId}`,
    windowMs: 60_000,
    maxAttempts: policy.publicQuizApiRequestsPerMinute,
    message: "공개 퀴즈 요청이 너무 잦습니다. 잠시 후 다시 시도해 주세요.",
  });
}
