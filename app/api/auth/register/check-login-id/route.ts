import { credentialLoginIdSchema } from "@/lib/auth/credentials";
import { registrationLoginIdAvailability } from "@/lib/auth/registration";
import { prepareLoginIdAvailabilityCheck } from "@/lib/auth/security";
import { apiError, assertSameOrigin } from "@/lib/http";
import { readJsonWithLimit } from "@/lib/http-json";
import { trustedClientIdentifier } from "@/lib/security/client-ip";
import { createLoginIdentifierLookup } from "@/lib/security/pii-crypto";

const CHECK_BODY_MAX_BYTES = 16 * 1024;

function response(body: Record<string, unknown>, init: ResponseInit = {}) {
  const headers = new Headers(init.headers);
  headers.set("Cache-Control", "no-store, max-age=0");
  return Response.json(body, { ...init, headers });
}

export async function POST(request: Request) {
  try {
    assertSameOrigin(request);
    const parsed = credentialLoginIdSchema.safeParse(await readJsonWithLimit(request, CHECK_BODY_MAX_BYTES));
    if (!parsed.success) {
      return response({ available: false, error: parsed.error.issues[0]?.message ?? "아이디를 확인해 주세요." }, { status: 400 });
    }
    // 차단된 요청이 아이디 존재 여부 조회까지 만들지 않도록, 정규화된 단방향 lookup으로
    // 계정별 제한을 먼저 소비합니다. 응답 모양은 동일하게 유지해 계정 열거 신호를 늘리지 않습니다.
    const loginIdentifierLookup = createLoginIdentifierLookup(parsed.data.loginId);
    const limit = await prepareLoginIdAvailabilityCheck(
      trustedClientIdentifier(request.headers),
      loginIdentifierLookup,
    );
    if (!limit.allowed) {
      return response(
        { available: false, error: "확인 요청이 너무 많습니다. 잠시 후 다시 시도해 주세요." },
        { status: 429, headers: { "Retry-After": String(Math.min(limit.retryAfterSeconds, 300)) } },
      );
    }
    const availability = await registrationLoginIdAvailability(parsed.data.loginId);
    return response({
      available: availability.available,
      error: availability.available ? undefined : "이미 사용 중이거나 가입할 수 없는 아이디입니다.",
    });
  } catch (error) {
    return apiError(error, "아이디 사용 여부를 확인하지 못했습니다.");
  }
}
