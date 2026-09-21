import { getCurrentUser } from "@/lib/auth/current-user";
import { dedupeKeyFor, resolveGuestToken, withGuestCookie } from "@/lib/forms/guest-access";
import { formResponseError } from "@/lib/forms/response-error";
import { submitResponseSchema } from "@/lib/forms/response-schema";
import {
  submitFormResponse,
  updateFormResponse,
} from "@/lib/forms/submit";
import { assertSameOrigin } from "@/lib/http";
import { readJsonWithLimit } from "@/lib/http-json";
import { getPrisma } from "@/lib/prisma";
import { assertRateLimit } from "@/lib/security/rate-limit";

const FORM_RESPONSE_BODY_MAX_BYTES = 3 * 1024 * 1024;

// 설문 제출/수정입니다. 실제 로직은 lib/forms/submit.ts에 있고, 여기서는 요청 안에서만
// 의미 있는 것 — same-origin, 레이트리밋, 신원 해석(로그인 vs 익명 쿠키) — 만 합니다.
//
// 로그인 사용자도 이 라우트를 씁니다(퀴즈가 `/join`·`/public/join`으로 갈렸다가 서로
// 리다이렉트하던 문제를 반복하지 않으려는 것입니다). requiresLogin인데 로그인이 안 된
// 요청은 여기서 막습니다.

export async function POST(request: Request, { params }: { params: Promise<{ slug: string }> }) {
  try {
    assertSameOrigin(request);
    // 로그인 사용자는 계정으로, 익명은 IP로 개별화합니다 — 계정 기준이면 같은 학교 공용
    // IP 뒤 여러 학생이 서로의 시도 횟수를 갉아먹지 않습니다. 프록시의 전역 쓰기 백스톱은
    // `/api/public/*`를 건너뛰므로 이 레이트리밋이 유일한 방어선입니다.
    const actor = await getCurrentUser();
    assertRateLimit(request, { scope: "form-submit", userId: actor?.id ?? null, windowMs: 60_000, maxAttempts: 10 });

    const { slug } = await params;
    const body = submitResponseSchema.parse(await readJsonWithLimit(request, FORM_RESPONSE_BODY_MAX_BYTES));

    const form = await getPrisma().form.findUnique({
      where: { slug },
      include: { fields: { orderBy: { position: "asc" }, include: { options: { orderBy: { position: "asc" } } } } },
    });
    if (!form || form.deletedAt) return Response.json({ error: "설문을 찾을 수 없습니다." }, { status: 404 });

    if (form.requiresLogin && !actor) return Response.json({ error: "로그인이 필요합니다." }, { status: 401 });

    const guest = actor ? null : resolveGuestToken(request, form.id);
    const identity = {
      respondentId: actor?.id ?? null,
      guestTokenHash: guest?.tokenHash ?? null,
    };

    const response = await submitFormResponse(form.id, identity, body);
    const payload = Response.json({ response: { id: response.id, submittedAt: response.submittedAt } }, { status: 201 });
    return guest ? withGuestCookie(payload, form.id, guest.token) : payload;
  } catch (error) {
    return formResponseError(error);
  }
}

export async function PATCH(request: Request, { params }: { params: Promise<{ slug: string }> }) {
  try {
    assertSameOrigin(request);
    const actor = await getCurrentUser();
    assertRateLimit(request, { scope: "form-submit-edit", userId: actor?.id ?? null, windowMs: 60_000, maxAttempts: 10 });

    const { slug } = await params;
    const body = submitResponseSchema.parse(await readJsonWithLimit(request, FORM_RESPONSE_BODY_MAX_BYTES));

    const form = await getPrisma().form.findUnique({
      where: { slug },
      include: { fields: { orderBy: { position: "asc" }, include: { options: { orderBy: { position: "asc" } } } } },
    });
    if (!form || form.deletedAt) return Response.json({ error: "설문을 찾을 수 없습니다." }, { status: 404 });

    // 복수 응답을 허용하는 설문은 dedupeKey가 없어(1인당 여러 응답) "내 응답"을 하나로 특정할
    // 수 없습니다. 그 경우는 응답 ID로 직접 가리키는 별도 경로가 필요한데(4단계 미결 항목),
    // 지금은 정직하게 거부합니다 — 아무 응답이나 골라 고치는 것보다 낫습니다.
    if (form.allowMultipleResponses) {
      return Response.json({ error: "여러 번 응답할 수 있는 설문은 이 화면에서 수정할 수 없습니다." }, { status: 409 });
    }

    if (form.requiresLogin && !actor) return Response.json({ error: "로그인이 필요합니다." }, { status: 401 });

    const guest = actor ? null : resolveGuestToken(request, form.id);
    const dedupeKey = dedupeKeyFor({ allowMultipleResponses: false, respondentId: actor?.id, guestTokenHash: guest?.tokenHash });

    const existing = dedupeKey
      ? await getPrisma().formResponse.findUnique({ where: { formId_dedupeKey: { formId: form.id, dedupeKey } }, select: { id: true } })
      : null;
    if (!existing) return Response.json({ error: "아직 응답한 적이 없습니다." }, { status: 404 });

    const response = await updateFormResponse(form.id, existing.id, body);
    const payload = Response.json({ response: { id: response.id, submittedAt: response.submittedAt } });
    return guest ? withGuestCookie(payload, form.id, guest.token) : payload;
  } catch (error) {
    return formResponseError(error);
  }
}
