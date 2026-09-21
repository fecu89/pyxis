import { requireActiveUser } from "@/lib/auth/authorization";
import { formClosedReason, FORM_FILE_TYPES, type FormFileType } from "@/lib/forms/field-types";
import { createFormUploadDirectory } from "@/lib/files/paths";
import { storeAttachmentUpload } from "@/lib/files/store-upload";
import { AttachmentLimitError } from "@/lib/files/validation";
import { apiError, assertSameOrigin } from "@/lib/http";
import { getPrisma } from "@/lib/prisma";
import { assertRateLimit } from "@/lib/security/rate-limit";

export const runtime = "nodejs";

export async function POST(request: Request, { params }: { params: Promise<{ slug: string; fieldId: string }> }) {
  let cleanup: (() => Promise<void>) | null = null;
  try {
    assertSameOrigin(request);
    const user = await requireActiveUser();
    assertRateLimit(request, { scope: "form-file-upload", userId: user.id, windowMs: 5 * 60_000, maxAttempts: 30 });
    const { slug, fieldId } = await params;
    const form = await getPrisma().form.findUnique({
      where: { slug },
      select: {
        id: true, status: true, deletedAt: true, openAt: true, closeAt: true, maxResponses: true, responseCount: true,
        fields: { where: { id: fieldId }, select: { id: true, type: true, fileMaxCount: true, fileMaxSizeMb: true, fileAllowedTypes: true } },
      },
    });
    const field = form?.fields[0];
    if (!form || form.deletedAt || !field) return Response.json({ error: "파일 질문을 찾을 수 없습니다." }, { status: 404 });
    if (formClosedReason(form)) return Response.json({ error: "지금은 이 설문에 파일을 올릴 수 없습니다." }, { status: 409 });
    if (field.type !== "FILE_UPLOAD") return Response.json({ error: "파일 업로드 질문이 아닙니다." }, { status: 400 });

    const allowedTypes = field.fileAllowedTypes.filter((type): type is FormFileType => (FORM_FILE_TYPES as readonly string[]).includes(type));
    const stored = await storeAttachmentUpload(request, createFormUploadDirectory(form.id, user.id), {
      allowedTypes,
      maxBytes: field.fileMaxSizeMb * 1024 * 1024,
      context: { target: "설문 파일 답변", userId: user.id },
    });
    cleanup = stored.cleanup;
    const file = await getPrisma().$transaction(async (tx) => {
      await tx.$queryRaw`SELECT "id" FROM "FormField" WHERE "id" = ${field.id} FOR UPDATE`;
      const pendingCount = await tx.formUploadedFile.count({ where: { fieldId, uploaderId: user.id, answerId: null, deletedAt: null } });
      if (pendingCount >= field.fileMaxCount) throw new AttachmentLimitError(`이 질문에는 파일을 ${field.fileMaxCount}개까지만 올릴 수 있습니다.`);
      return tx.formUploadedFile.create({
        data: { formId: form.id, fieldId, uploaderId: user.id, ...stored.data, storagePath: stored.data.storagePath! },
        select: { id: true, originalName: true, mimeType: true, fileSize: true },
      });
    });
    cleanup = null;
    return Response.json({ file: { ...file, url: `/form-files/${file.id}` } }, { status: 201 });
  } catch (error) {
    if (cleanup) await cleanup();
    if (error instanceof AttachmentLimitError) return Response.json({ error: error.message }, { status: 400 });
    return apiError(error, "설문 파일을 업로드하지 못했습니다.");
  }
}
