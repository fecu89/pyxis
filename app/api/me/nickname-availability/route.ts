import { requireActiveUser } from "@/lib/auth/authorization";
import { apiError, assertSameOrigin } from "@/lib/http";
import { readJsonWithLimit } from "@/lib/http-json";
import { isNicknameAvailable, nicknameSchema } from "@/lib/users/nickname";

const REQUEST_BODY_MAX_BYTES = 16 * 1024;

function response(body: Record<string, unknown>, init: ResponseInit = {}) {
  const headers = new Headers(init.headers);
  headers.set("Cache-Control", "private, no-store");
  return Response.json(body, { ...init, headers });
}

export async function POST(request: Request) {
  try {
    assertSameOrigin(request);
    const user = await requireActiveUser();
    const parsed = nicknameSchema.safeParse(
      (await readJsonWithLimit(request, REQUEST_BODY_MAX_BYTES) as { name?: unknown } | null)?.name,
    );
    if (!parsed.success) {
      return response({ available: false, error: parsed.error.issues[0]?.message ?? "닉네임을 확인해 주세요." }, { status: 400 });
    }
    // 중복은 같은 학교 안에서만 봅니다. 학교가 아직 없는 계정은 "학교 없음" 버킷끼리 비교합니다.
    const result = await isNicknameAvailable(parsed.data, { schoolId: user.school?.id ?? null, excludeUserId: user.id });
    return response({
      available: result.available,
      normalized: result.normalized,
      error: result.available ? undefined : "같은 학교에서 이미 사용 중인 닉네임입니다.",
    });
  } catch (error) {
    return apiError(error, "닉네임 사용 여부를 확인하지 못했습니다.");
  }
}
