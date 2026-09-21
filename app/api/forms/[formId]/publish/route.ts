import { syncActivity } from "@/lib/activity/ensure";
import { requireActiveUser } from "@/lib/auth/authorization";
import { requireManageableForm, shouldClearCloseAt } from "@/lib/forms/access";
import { fieldCompletionError, formCompletionError, type EditorField } from "@/lib/forms/field-schema";
import { apiError, assertSameOrigin } from "@/lib/http";
import { getPrisma } from "@/lib/prisma";
import { parseFieldValidation } from "@/lib/forms/validation";

// 발행: DRAFT·CLOSED → OPEN. 링크가 살아나고 응답을 받기 시작합니다.
//
// 완성도 검사는 편집기와 **같은 함수**(fieldCompletionError)를 씁니다. 화면에서만 검사하면
// 요청을 직접 보내 빈 설문을 발행할 수 있고, 서버에만 두면 어느 질문이 문제인지 못 짚어 줍니다.

export async function POST(_request: Request, { params }: { params: Promise<{ formId: string }> }) {
  try {
    assertSameOrigin(_request);
    const actor = await requireActiveUser();
    const { formId } = await params;
    const form = await requireManageableForm(formId, actor);

    const prisma = getPrisma();
    const fields = await prisma.formField.findMany({
      where: { formId },
      orderBy: { position: "asc" },
      include: { options: { orderBy: { position: "asc" } } },
    });
    if (!fields.length) return Response.json({ error: "질문이 1개 이상 있어야 발행할 수 있습니다." }, { status: 400 });

    if (!form.requiresLogin && fields.some((field) => field.type === "FILE_UPLOAD")) {
      return Response.json({ error: "파일 업로드 질문이 있는 설문은 로그인이 필요합니다." }, { status: 400 });
    }

    for (const [index, field] of fields.entries()) {
      const message = fieldCompletionError(toEditorField(field));
      if (message) return Response.json({ error: `${index + 1}번 질문을 완성해 주세요. ${message}`, fieldIndex: index }, { status: 400 });
    }
    if (fields.every((field) => field.type === "SECTION_HEADER")) {
      return Response.json({ error: "응답을 받는 질문이 하나도 없습니다." }, { status: 400 });
    }
    const documentError = formCompletionError(fields.map(toEditorField));
    if (documentError) return Response.json({ error: `${documentError.index + 1}번 질문을 완성해 주세요. ${documentError.message}`, fieldIndex: documentError.index }, { status: 400 });

    const now = new Date();
    const updated = await prisma.$transaction(async (tx) => {
      const next = await tx.form.update({
        where: { id: formId },
        // 이미 지난 마감만 지웁니다 — 무조건 지우면 첫 발행에서 미리 정한 예약 마감이 사라지고,
        // 지난 마감을 안 지우면 재개해도 formClosedReason이 곧바로 PAST_DUE로 되돌립니다.
        data: { status: "OPEN", ...(shouldClearCloseAt(form.closeAt, now) ? { closeAt: null } : {}) },
        // 발행도 updatedAt을 바꾸므로 편집기가 최신 값을 받아야 이후 자동 저장이 낙관적 잠금에
        // 막히지 않습니다.
        select: { id: true, status: true, slug: true, title: true, updatedAt: true },
      });
      // 활동의 startedAt은 "응답을 받기 시작한 시각"입니다. 다시 여는 경우 처음 발행 시각을
      // 유지해야 /report의 시간축이 흔들리지 않으므로 비어 있을 때만 채웁니다.
      const activity = await tx.activity.findUnique({ where: { id: form.activityId }, select: { startedAt: true } });
      await syncActivity(tx, form.activityId, { startedAt: activity?.startedAt ?? now, endedAt: null });
      return next;
    });

    return Response.json({ form: updated });
  } catch (error) {
    return apiError(error, "설문을 발행하지 못했습니다.");
  }
}

/** DB 행을 완성도 검사가 받는 모양으로. 검사는 편집기 타입을 기준으로 쓰여 있습니다. */
function toEditorField(field: {
  id: string;
  type: string;
  title: string;
  description: string | null;
  required: boolean;
  scaleMin: number | null;
  scaleMax: number | null;
  scaleMinLabel: string | null;
  scaleMaxLabel: string | null;
  ratingMax: number | null;
  ratingIcon: string | null;
  includeYear: boolean;
  includeTime: boolean;
  durationMode: boolean;
  shuffleOptions: boolean;
  allowOther: boolean;
  gridRows: string[];
  gridRequireOneResponsePerRow: boolean;
  validation: unknown;
  branchRules: unknown;
  fileMaxCount: number;
  fileMaxSizeMb: number;
  fileAllowedTypes: string[];
  options: { id: string; text: string }[];
}): EditorField {
  return {
    id: field.id,
    type: field.type,
    title: field.title,
    description: field.description,
    required: field.required,
    options: field.options.map((option) => ({ id: option.id, text: option.text })),
    shuffleOptions: field.shuffleOptions,
    allowOther: field.allowOther,
    gridRows: field.gridRows,
    gridRequireOneResponsePerRow: field.gridRequireOneResponsePerRow,
    scaleMin: field.scaleMin,
    scaleMax: field.scaleMax,
    scaleMinLabel: field.scaleMinLabel ?? "",
    scaleMaxLabel: field.scaleMaxLabel ?? "",
    ratingMax: field.ratingMax,
    ratingIcon: field.ratingIcon,
    includeYear: field.includeYear,
    includeTime: field.includeTime,
    durationMode: field.durationMode,
    validation: parseFieldValidation(field.validation),
    branchRules: Array.isArray(field.branchRules) ? field.branchRules : [],
    fileMaxCount: field.fileMaxCount,
    fileMaxSizeMb: field.fileMaxSizeMb,
    fileAllowedTypes: field.fileAllowedTypes,
  } as EditorField;
}
