import { requireActiveUser } from "@/lib/auth/authorization";
import { requireViewableForm } from "@/lib/forms/access";
import { gatherFormExportData } from "@/lib/forms/summary";
import { buildFormWorkbook } from "@/lib/forms/xlsx";
import { contentDisposition } from "@/lib/exports/download";
import { apiError } from "@/lib/http";
import { assertRateLimit } from "@/lib/security/rate-limit";

export const runtime = "nodejs"; // exceljs는 엣지에서 안 돕니다.

export async function GET(request: Request, { params }: { params: Promise<{ formId: string }> }) {
  try {
    const actor = await requireActiveUser();
    const { formId } = await params;
    const form = await requireViewableForm(formId, actor).then((access) => access.form);
    assertRateLimit(request, {
      scope: `form-xlsx-export:${formId}`,
      userId: actor.id,
      windowMs: 60_000,
      maxAttempts: 5,
      message: "XLSX 내보내기 요청이 너무 잦습니다. 잠시 후 다시 시도해 주세요.",
    });

    const data = await gatherFormExportData(formId);
    const buffer = await buildFormWorkbook(data);

    return new Response(buffer, {
      headers: {
        "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "Content-Disposition": contentDisposition(`${form.title || "설문"}.xlsx`),
      },
    });
  } catch (error) {
    return apiError(error, "XLSX로 내보내지 못했습니다.");
  }
}
