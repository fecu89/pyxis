import { getCurrentUser } from "@/lib/auth/current-user";
import { editableAnswers } from "@/lib/forms/editable-answers";
import { hashGuestToken, readGuestToken } from "@/lib/forms/guest-access";
import { formResponseError } from "@/lib/forms/response-error";
import { submitResponseSchema } from "@/lib/forms/response-schema";
import { updateFormResponse } from "@/lib/forms/submit";
import { apiError, assertSameOrigin } from "@/lib/http";
import { readJsonWithLimit } from "@/lib/http-json";
import { getPrisma } from "@/lib/prisma";
import { assertRateLimit } from "@/lib/security/rate-limit";

const BODY_MAX = 3 * 1024 * 1024;
const answerSelect = {
  fieldId: true, fieldType: true, textValue: true, selectedOptionIds: true, numberValue: true,
  dateValue: true, timeValue: true, gridValue: true, signatureStrokes: true,
  files: { where: { deletedAt: null }, select: { id: true } },
} as const;

async function ownedResponse(request: Request, slug: string, responseId: string) {
  const actor = await getCurrentUser();
  const form = await getPrisma().form.findUnique({
    where: { slug },
    include: {
      fields: { orderBy: { position: "asc" }, include: { options: { orderBy: { position: "asc" } } } },
      responses: { where: { id: responseId }, take: 1, select: { id: true, respondentId: true, guestTokenHash: true, answers: { select: answerSelect } } },
    },
  });
  if (!form || form.deletedAt) return null;
  const response = form.responses[0];
  const token = actor ? null : readGuestToken(request, form.id);
  const owns = Boolean(response && (
    (actor && response.respondentId === actor.id)
    || (!actor && token && response.guestTokenHash === hashGuestToken(token))
  ));
  return owns ? { form, response } : null;
}

export async function GET(request: Request, { params }: { params: Promise<{ slug: string; responseId: string }> }) {
  try {
    const { slug, responseId } = await params;
    const owned = await ownedResponse(request, slug, responseId);
    if (!owned) return Response.json({ error: "응답을 찾을 수 없거나 수정 권한이 없습니다." }, { status: 404 });
    if (!owned.form.allowEditAfterSubmit) return Response.json({ error: "이 설문은 제출 후 수정할 수 없습니다." }, { status: 403 });
    return Response.json({ existingAnswers: editableAnswers(owned.form.fields, owned.response.answers), canEdit: true });
  } catch (error) {
    return apiError(error, "응답을 불러오지 못했습니다.");
  }
}

export async function PATCH(request: Request, { params }: { params: Promise<{ slug: string; responseId: string }> }) {
  try {
    assertSameOrigin(request);
    const actor = await getCurrentUser();
    assertRateLimit(request, { scope: "form-submit-edit", userId: actor?.id ?? null, windowMs: 60_000, maxAttempts: 10 });
    const { slug, responseId } = await params;
    const owned = await ownedResponse(request, slug, responseId);
    if (!owned) return Response.json({ error: "응답을 찾을 수 없거나 수정 권한이 없습니다." }, { status: 404 });
    const body = submitResponseSchema.parse(await readJsonWithLimit(request, BODY_MAX));
    const response = await updateFormResponse(owned.form.id, responseId, body);
    return Response.json({ response });
  } catch (error) {
    return formResponseError(error);
  }
}
