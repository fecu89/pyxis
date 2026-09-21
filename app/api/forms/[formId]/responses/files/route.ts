import { Readable } from "node:stream";
import { requireActiveUser } from "@/lib/auth/authorization";
import { requireViewableForm } from "@/lib/forms/access";
import { contentDisposition } from "@/lib/exports/download";
import { buildFormResponseFilesZipStream, gatherFormResponseFiles } from "@/lib/forms/response-files-export";
import { apiError } from "@/lib/http";
import { assertRateLimit } from "@/lib/security/rate-limit";

export const runtime = "nodejs";

export async function GET(request: Request, { params }: { params: Promise<{ formId: string }> }) {
  try {
    const actor = await requireActiveUser();
    const { formId } = await params;
    const form = await requireViewableForm(formId, actor).then((access) => access.form);
    assertRateLimit(request, {
      scope: `form-response-files-export:${formId}`,
      userId: actor.id,
      windowMs: 60_000,
      maxAttempts: 3,
      message: "응답 파일 내보내기 요청이 너무 잦습니다. 잠시 후 다시 시도해 주세요.",
    });

    const data = await gatherFormResponseFiles(formId);
    if (!data.artifactCount) return Response.json({ error: "내려받을 첨부 파일이나 서명이 없습니다." }, { status: 404 });
    const archive = buildFormResponseFilesZipStream(data);
    return new Response(Readable.toWeb(archive) as ReadableStream<Uint8Array>, {
      headers: {
        "Content-Type": "application/zip",
        "Content-Disposition": contentDisposition(`${form.title || "설문"}_응답파일.zip`),
        "Cache-Control": "private, no-store",
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch (error) {
    return apiError(error, "응답 파일을 압축하지 못했습니다.");
  }
}
