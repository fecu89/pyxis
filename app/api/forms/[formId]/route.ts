import { requireActiveUser } from "@/lib/auth/authorization";
import { requireManageableForm, requireOwnedForm, requireViewableForm } from "@/lib/forms/access";
import { formSaveSchema } from "@/lib/forms/field-schema";
import { ConflictSaveError, DestructiveSaveError, loadFormDocument, saveFormDocument } from "@/lib/forms/save";
import { apiError, assertSameOrigin } from "@/lib/http";
import { readJsonWithLimit } from "@/lib/http-json";
import { getPrisma } from "@/lib/prisma";

const FORM_DOCUMENT_BODY_MAX_BYTES = 3 * 1024 * 1024;

// 설문 문서 하나. PUT이 편집기의 전체 문서 저장입니다(알고리즘은 lib/forms/save.ts).

export async function GET(_request: Request, { params }: { params: Promise<{ formId: string }> }) {
  try {
    const actor = await requireActiveUser();
    const { formId } = await params;
    const access = await requireViewableForm(formId, actor);

    const [form, availableSubjects] = await Promise.all([
      loadFormDocument(formId),
      access.level === "VIEWER"
        ? Promise.resolve([])
        : getPrisma().subject.findMany({
          where: { ownerId: access.form.ownerId },
          orderBy: { name: "asc" },
          select: { id: true, name: true },
        }),
    ]);
    return Response.json({ form: form ? { ...form, accessLevel: access.level, availableSubjects } : null });
  } catch (error) {
    return apiError(error, "설문을 불러오지 못했습니다.");
  }
}

export async function PUT(request: Request, { params }: { params: Promise<{ formId: string }> }) {
  try {
    assertSameOrigin(request);
    const actor = await requireActiveUser();
    const { formId } = await params;
    await requireManageableForm(formId, actor);
    const parsed = formSaveSchema.safeParse(await readJsonWithLimit(request, FORM_DOCUMENT_BODY_MAX_BYTES));
    if (!parsed.success) {
      return Response.json(
        { code: "FORM_VALIDATION_ERROR", error: parsed.error.issues[0]?.message ?? "설문 내용을 확인해 주세요." },
        { status: 400 },
      );
    }

    const form = await saveFormDocument(formId, parsed.data);
    return Response.json({ form });
  } catch (error) {
    // 응답이 달린 질문을 지우려는 경우만 따로 알려 줍니다. 편집기가 몇 건이 사라지는지 보여 준 뒤
    // `confirmDestructive`를 붙여 다시 보냅니다.
    if (error instanceof DestructiveSaveError) {
      return Response.json({ error: error.message, needsConfirm: true, answerCount: error.answerCount }, { status: 409 });
    }
    // 편집기가 "확인하고 다시 보내기"(needsConfirm)와 "새로고침해야 함"(needsReload)을
    // 구분해야 하는데, 에러 문구 비교는 문구를 고치는 순간 조용히 깨집니다.
    if (error instanceof ConflictSaveError) {
      return Response.json({ error: error.message, needsReload: true }, { status: 409 });
    }
    return apiError(error, "설문을 저장하지 못했습니다.");
  }
}

export async function DELETE(request: Request, { params }: { params: Promise<{ formId: string }> }) {
  try {
    assertSameOrigin(request);
    const actor = await requireActiveUser();
    const { formId } = await params;
    await requireOwnedForm(formId, actor);
    // 소프트 삭제입니다. 응답은 남겨 두고 목록에서만 사라집니다 — 응답자가 낸 것을 소유자가
    // 화면에서 지웠다는 이유로 즉시 없애면 되돌릴 방법이 없습니다.
    await getPrisma().form.update({ where: { id: formId }, data: { deletedAt: new Date() } });
    return Response.json({ ok: true });
  } catch (error) {
    return apiError(error, "설문을 삭제하지 못했습니다.");
  }
}
