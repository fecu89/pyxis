import "../lib/load-env";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { getPrisma } from "../lib/prisma";
import { getPlatformSecurityPolicy } from "../lib/security/platform-policy";
import { assertPublicQuizApiRateLimit, assertPublicQuizInvalidPinRateLimit, assertPublicQuizJoinRateLimit } from "../lib/security/public-quiz-rate-limit";
import { RateLimitError } from "../lib/security/rate-limit";

async function main() {
  const previousTrust = process.env.TRUST_CLOUDFLARE_IP_HEADER;
  process.env.TRUST_CLOUDFLARE_IP_HEADER = "true";
  try {
    const policy = await getPlatformSecurityPolicy({ fresh: true });
    const request = new Request("https://c.pyx.kr/api/public/sessions/join", {
      headers: { "cf-connecting-ip": `192.0.2.${Math.floor(Math.random() * 200) + 1}` },
    });
    for (let index = 0; index < policy.publicQuizJoinPerMinute; index += 1) {
      await assertPublicQuizJoinRateLimit(request);
    }
    await assert.rejects(() => assertPublicQuizJoinRateLimit(request), RateLimitError);

    const invalidPinRequest = new Request("https://c.pyx.kr/api/public/sessions/join", {
      headers: { "cf-connecting-ip": `198.51.100.${Math.floor(Math.random() * 200) + 1}` },
    });
    for (let index = 0; index < 20; index += 1) assertPublicQuizInvalidPinRateLimit(invalidPinRequest);
    assert.throws(() => assertPublicQuizInvalidPinRateLimit(invalidPinRequest), RateLimitError);

    const participantId = `verify-${randomUUID()}`;
    for (let index = 0; index < policy.publicQuizApiRequestsPerMinute; index += 1) {
      await assertPublicQuizApiRateLimit(request, participantId);
    }
    await assert.rejects(() => assertPublicQuizApiRateLimit(request, participantId), RateLimitError);

    assert.ok(policy.publicQuizSocketMaxConnections >= policy.publicQuizSocketConnectionsPerIp);
    assert.ok(policy.publicQuizSocketConnectionsPerIp >= policy.publicQuizSocketConnectionsPerParticipant);
    assert.ok(policy.publicQuizSocketConnectionsPerIp >= 100, "학교 NAT 뒤 100명 수업을 IP 소켓 상한이 막으면 안 됩니다.");
    console.log(`public_quiz_limit_checks=passed join=${policy.publicQuizJoinPerMinute}/min api=${policy.publicQuizApiRequestsPerMinute}/min`);
  } finally {
    if (previousTrust === undefined) delete process.env.TRUST_CLOUDFLARE_IP_HEADER;
    else process.env.TRUST_CLOUDFLARE_IP_HEADER = previousTrust;
    await getPrisma().$disconnect();
  }
}

void main();
