import { requireActiveUser } from "@/lib/auth/authorization";
import { requireViewableForm } from "@/lib/forms/access";
import { contentDisposition } from "@/lib/exports/download";
import { renderSignatureSvg } from "@/lib/forms/response-files-export";
import { parseSignatureStrokes } from "@/lib/forms/signature";
import { getFormResponseDetail } from "@/lib/forms/summary";
import { apiError } from "@/lib/http";
import { assertRateLimit } from "@/lib/security/rate-limit";

export const runtime = "nodejs";

export async function GET(request: Request, { params }: { params: Promise<{ formId: string; responseId: string; fieldId: string }> }) {
  try {
    const actor = await requireActiveUser();
    const { formId, responseId, fieldId } = await params;
    await requireViewableForm(formId, actor);
    assertRateLimit(request, {
      scope: `form-signature-download:${formId}`,
      userId: actor.id,
      windowMs: 60_000,
      maxAttempts: 30,
      message: "서명 다운로드 요청이 너무 잦습니다. 잠시 후 다시 시도해 주세요.",
    });

    const response = await getFormResponseDetail(formId, responseId);
    const answer = response?.answers.find((item) => item.fieldId === fieldId && item.fieldType === "SIGNATURE");
    const strokes = parseSignatureStrokes(answer?.signatureStrokes);
    if (!response || !answer || !strokes.length) {
      return Response.json({ error: "서명을 찾을 수 없습니다." }, { status: 404 });
    }

    const svg = renderSignatureSvg(strokes);
    return new Response(svg, {
      headers: {
        "Content-Type": "image/svg+xml; charset=utf-8",
        "Content-Disposition": contentDisposition(`${response.respondentLabel}_${answer.fieldTitle || "서명"}.svg`),
        "Cache-Control": "private, no-store",
        "Content-Security-Policy": "default-src 'none'; sandbox",
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch (error) {
    return apiError(error, "서명을 내려받지 못했습니다.");
  }
}
