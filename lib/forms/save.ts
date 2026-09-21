import "server-only";

import { randomUUID } from "node:crypto";
import { Prisma } from "@/generated/prisma/client";
import { syncActivity } from "@/lib/activity/ensure";
import { getPrisma } from "@/lib/prisma";
import { hasOptions, isDisplayOnly, isGridType } from "@/lib/forms/field-types";
import { bulkUpdateFormOptions, type FormOptionBulkUpdate } from "@/lib/forms/option-bulk-update";
import type { EditorField, FormSaveInput } from "@/lib/forms/field-schema";
import { cleanSubjectName, normalizeSubjectName } from "@/lib/quiz/subjects";
import { removeStoredAttachmentFiles, type StoredAttachmentFiles } from "@/lib/files/cleanup";

// 편집기가 보낸 문서 하나를 통째로 반영합니다. 라우트가 아니라 여기 있는 이유는 알고리즘이
// 길고, 검증 스크립트가 HTTP를 거치지 않고 직접 부를 수 있어야 하기 때문입니다.
//
// 규칙 다섯:
//   1. 요청의 ID 집합이 현재 문서와 정확히 일치하지 않으면 **저장 전체를 거부**합니다.
//      부분 적용보다 거부가 낫습니다 — 편집기가 낡았다는 뜻이라 새로고침을 시켜야 합니다.
//   2. 유형에 안 맞는 열은 **명시적으로 초기화**합니다. 유형을 바꿨는데 이전 유형의 값이 남으면
//      화면과 집계가 그 값을 계속 읽습니다.
//   3. 보기는 지우고 다시 만들지 않고 **ID를 보존**한 채 갱신합니다. ID가 바뀌면 그 보기를 고른
//      과거 응답의 집계가 0이 됩니다.
//   4. 저장은 `status`를 건드리지 않습니다. OPEN 상태에서도 질문 추가·수정·삭제를 허용합니다.
//      다만 기존 답변이 달린 질문 삭제는 아래의 명시적 확인 절차를 그대로 거칩니다.
//   5. `expectedUpdatedAt`이 왔는데 실제 `Form.updatedAt`과 다르면 거부합니다. 편집기의
//      `isCurrent()`는 같은 탭 안의 편집만 보호해서, 다른 탭이나 공유받은 EDITOR가 그 사이에
//      먼저 저장한 문서를 "지금 화면 그대로"로 덮어쓰는 것은 막지 못합니다.

export class FormSaveError extends Error {}

/** 응답이 이미 달린 질문을 지우려 할 때. 편집기가 사용자에게 확인을 받고 다시 보냅니다. */
export class DestructiveSaveError extends FormSaveError {
  constructor(readonly answerCount: number) {
    super(`지우려는 질문에 응답 ${answerCount}건이 달려 있습니다. 함께 지울지 확인해 주세요.`);
  }
}

/** 저장하는 사이에 다른 곳에서 먼저 저장했을 때. */
export class ConflictSaveError extends FormSaveError {
  constructor() {
    super("다른 곳에서 먼저 저장했습니다. 최신 내용을 다시 불러온 뒤 시도해 주세요.");
  }
}

type FieldColumns = Omit<Prisma.FormFieldUncheckedCreateInput, "formId" | "id">;

/**
 * 한 필드의 모든 열 값을 만듭니다. **유형에 안 맞는 열은 빠짐없이 기본값으로 되돌립니다.**
 *
 * "바뀐 것만 넣기"로 하면 LINEAR_SCALE이던 질문을 SHORT_TEXT로 바꿔도 scaleMin/scaleMax가
 * 남고, 나중에 다시 척도로 바꿨을 때 예전 눈금이 되살아납니다. 응답 집계는 그 값을 보고
 * 계산하므로 조용히 틀린 결과가 나옵니다.
 */
function fieldColumns(field: EditorField, position: number, fieldIdByClientId: Map<string, string>): FieldColumns {
  const columns: FieldColumns = {
    type: field.type,
    title: field.title,
    description: field.description,
    // 설명 블록은 응답을 받지 않으므로 필수일 수 없습니다.
    required: isDisplayOnly(field.type) ? false : field.required,
    position,
    imageUrl: field.imageUrl ?? null,
    imageAlt: field.imageAlt ?? null,
    shuffleOptions: false,
    allowOther: false,
    gridRows: [],
    gridRequireOneResponsePerRow: false,
    scaleMin: null,
    scaleMax: null,
    scaleMinLabel: null,
    scaleMaxLabel: null,
    ratingMax: null,
    ratingIcon: null,
    includeYear: true,
    includeTime: false,
    durationMode: false,
    validation: Prisma.DbNull,
    branchRules: Prisma.DbNull,
    fileMaxCount: 1,
    fileMaxSizeMb: 10,
    fileAllowedTypes: ["IMAGE", "PDF", "DOCUMENT"],
  };

  if ("shuffleOptions" in field) columns.shuffleOptions = field.shuffleOptions;
  if ("allowOther" in field) columns.allowOther = field.allowOther;
  if ("gridRows" in field) {
    columns.gridRows = field.gridRows;
    columns.gridRequireOneResponsePerRow = field.gridRequireOneResponsePerRow;
  }
  if (field.type === "LINEAR_SCALE") {
    columns.scaleMin = field.scaleMin;
    columns.scaleMax = field.scaleMax;
    columns.scaleMinLabel = field.scaleMinLabel;
    columns.scaleMaxLabel = field.scaleMaxLabel;
  }
  if (field.type === "RATING") {
    columns.ratingMax = field.ratingMax;
    columns.ratingIcon = field.ratingIcon;
  }
  if (field.type === "DATE") {
    columns.includeYear = field.includeYear;
    columns.includeTime = field.includeTime;
  }
  if (field.type === "TIME") columns.durationMode = field.durationMode;
  if ((field.type === "MULTIPLE_CHOICE" || field.type === "DROPDOWN") && field.branchRules.length) {
    columns.branchRules = field.branchRules.map((rule) => ({
      optionId: rule.optionId,
      destination: fieldIdByClientId.get(rule.destination) ?? rule.destination,
    }));
  }
  if (field.type === "FILE_UPLOAD") {
    columns.fileMaxCount = field.fileMaxCount;
    columns.fileMaxSizeMb = field.fileMaxSizeMb;
    columns.fileAllowedTypes = field.fileAllowedTypes;
  }
  if ("validation" in field && field.validation) columns.validation = field.validation;

  return columns;
}

/** 이 필드가 실제로 가지는 보기 목록. 그리드는 **열**이 보기입니다. */
function optionsOf(field: EditorField) {
  return hasOptions(field.type) && "options" in field ? field.options : [];
}

export async function saveFormDocument(formId: string, body: FormSaveInput) {
  const prisma = getPrisma();
  const filesToRemove: StoredAttachmentFiles[] = [];
  validateBranchConfiguration(body.fields);

  await prisma.$transaction(async (tx) => {
    // `findUnique` 뒤 비교만 하면 동시에 시작한 두 저장이 같은 updatedAt을 읽고 둘 다 통과할
    // 수 있습니다. 먼저 행을 잠가 두 번째 저장이 첫 번째 커밋 뒤의 updatedAt을 읽게 합니다.
    await tx.$queryRaw<Array<{ id: string }>>`
      SELECT "id" FROM "Form" WHERE "id" = ${formId} FOR UPDATE
    `;
    const form = await tx.form.findUniqueOrThrow({
      where: { id: formId },
      select: { id: true, ownerId: true, activityId: true, updatedAt: true },
    });
    if (body.expectedUpdatedAt && form.updatedAt.toISOString() !== body.expectedUpdatedAt) {
      throw new ConflictSaveError();
    }

    const existingFields = await tx.formField.findMany({
      where: { formId },
      include: { options: { orderBy: { position: "asc" } } },
    });
    const existingById = new Map(existingFields.map((field) => [field.id, field]));
    const requestedIds = body.fields.flatMap((field) => (field.id ? [field.id] : []));
    if (new Set(requestedIds).size !== requestedIds.length || requestedIds.some((id) => !existingById.has(id))) {
      throw new FormSaveError("저장할 질문 목록이 현재 설문과 일치하지 않습니다. 새로고침 후 다시 시도해 주세요.");
    }
    const requestedIdSet = new Set(requestedIds);
    const removedIds = existingFields.filter((field) => !requestedIdSet.has(field.id)).map((field) => field.id);

    if (removedIds.length) {
      filesToRemove.push(...await tx.formUploadedFile.findMany({ where: { fieldId: { in: removedIds } }, select: { storagePath: true, thumbnailPath: true } }));
      const answerCount = await tx.formAnswer.count({ where: { fieldId: { in: removedIds } } });
      // FormAnswer → FormField가 RESTRICT라 답변을 먼저 지워야 합니다. 그 전에 사용자가 정말
      // 지우려는 것인지 확인을 받습니다 — 되돌릴 수 없는 데이터 손실입니다.
      if (answerCount > 0) {
        if (!body.confirmDestructive) throw new DestructiveSaveError(answerCount);
        await tx.formAnswer.deleteMany({ where: { fieldId: { in: removedIds } } });
      }
      await tx.formField.deleteMany({ where: { id: { in: removedIds } } });
    }

    const optionsToUpdate: FormOptionBulkUpdate[] = [];
    const optionsToCreate: Prisma.FormFieldOptionCreateManyInput[] = [];
    const optionIdsToRemove: string[] = [];

    // 새 섹션도 같은 저장에서 분기 대상으로 쓸 수 있도록 실제 ID를 먼저 모두 예약합니다.
    const fieldIdByClientId = new Map(body.fields.flatMap((field) => (
      field.clientId ? [[field.clientId, field.id ?? randomUUID()] as const] : []
    )));

    for (const [position, field] of body.fields.entries()) {
      const columns = fieldColumns(field, position, fieldIdByClientId);
      const options = optionsOf(field);

      if (!field.id) {
        await tx.formField.create({
          data: {
            ...columns,
            id: field.clientId ? fieldIdByClientId.get(field.clientId)! : undefined,
            formId,
            options: { create: options.map((option, index) => ({ id: option.clientId, text: option.text, position: index })) },
          },
        });
        continue;
      }

      const previous = existingById.get(field.id)!;
      const previousById = new Map(previous.options.map((option) => [option.id, option]));
      const keptIds = options.flatMap((option) => (option.id ? [option.id] : []));
      if (new Set(keptIds).size !== keptIds.length || keptIds.some((id) => !previousById.has(id))) {
        throw new FormSaveError("저장할 보기 목록이 현재 설문과 일치하지 않습니다. 새로고침 후 다시 시도해 주세요.");
      }
      const keptIdSet = new Set(keptIds);
      for (const option of previous.options) {
        if (!keptIdSet.has(option.id)) optionIdsToRemove.push(option.id);
      }
      for (const [index, option] of options.entries()) {
        if (!option.id) {
          optionsToCreate.push({ id: option.clientId, fieldId: field.id, text: option.text, position: index });
          continue;
        }
        const before = previousById.get(option.id)!;
        // 안 바뀐 보기는 건드리지 않습니다. 20문항 설문에서 매번 100건을 갱신할 이유가 없습니다.
        if (before.text !== option.text || before.position !== index) {
          optionsToUpdate.push({ id: option.id, text: option.text, position: index });
        }
      }

      await tx.formField.update({ where: { id: field.id }, data: columns });
    }

    // 보기 변경은 질문마다 왕복하지 않고 세 버킷에 모아 마지막에 한 번씩 처리합니다.
    if (optionIdsToRemove.length) await tx.formFieldOption.deleteMany({ where: { id: { in: optionIdsToRemove } } });
    await bulkUpdateFormOptions(tx, optionsToUpdate);
    if (optionsToCreate.length) await tx.formFieldOption.createMany({ data: optionsToCreate });

    const subjectName = cleanSubjectName(body.subjectName);
    const subjectId = subjectName
      ? (await tx.subject.upsert({
        where: { ownerId_nameNormalized: { ownerId: form.ownerId, nameNormalized: normalizeSubjectName(subjectName) } },
        create: { ownerId: form.ownerId, name: subjectName, nameNormalized: normalizeSubjectName(subjectName) },
        update: { name: subjectName },
        select: { id: true },
      })).id
      : null;

    await tx.form.update({
      where: { id: formId },
      data: {
        title: body.title,
        description: body.description,
        subjectId,
        requiresLogin: body.requiresLogin,
        allowMultipleResponses: body.allowMultipleResponses,
        allowEditAfterSubmit: body.allowEditAfterSubmit,
        shuffleFields: body.shuffleFields,
        showProgressBar: body.showProgressBar,
        confirmationMessage: body.confirmationMessage,
        closedMessage: body.closedMessage,
        dailyResponseDigestEnabled: body.dailyResponseDigestEnabled,
        ...(!body.dailyResponseDigestEnabled ? { responseDigestPendingCount: 0, responseDigestPendingSince: null } : {}),
        openAt: body.openAt ? new Date(body.openAt) : null,
        closeAt: body.closeAt ? new Date(body.closeAt) : null,
        maxResponses: body.maxResponses,
      },
    });

    // 제목이 바뀌면 /report 목록도 따라가야 합니다.
    await syncActivity(tx, form.activityId, { title: body.title });
  });

  if (filesToRemove.length) await removeStoredAttachmentFiles(filesToRemove);

  return loadFormDocument(formId);
}

function validateBranchConfiguration(fields: EditorField[]) {
  const sectionPositions = new Map<string, number>();
  fields.forEach((field, index) => {
    if (field.type !== "SECTION_HEADER") return;
    if (field.id) sectionPositions.set(field.id, index);
    if (field.clientId) sectionPositions.set(field.clientId, index);
  });
  let sectionStart = 0;
  let branchSeen = false;
  for (const [index, field] of fields.entries()) {
    if (field.type === "SECTION_HEADER") { sectionStart = index; branchSeen = false; }
    if (!(field.type === "MULTIPLE_CHOICE" || field.type === "DROPDOWN") || !field.branchRules.length) continue;
    if (branchSeen) throw new FormSaveError("한 섹션에는 답변별 이동 질문을 하나만 둘 수 있습니다.");
    branchSeen = true;
    const optionIds = new Set(field.options.flatMap((option) => {
      const optionId = option.id ?? option.clientId;
      return optionId ? [optionId] : [];
    }));
    for (const rule of field.branchRules) {
      if (!optionIds.has(rule.optionId)) throw new FormSaveError("존재하지 않는 보기의 이동 규칙이 포함되어 있습니다.");
      if (rule.destination === "SUBMIT") continue;
      const target = sectionPositions.get(rule.destination);
      if (target === undefined || target <= sectionStart) throw new FormSaveError("이동 대상은 현재보다 뒤에 있는 섹션이어야 합니다.");
    }
  }
}

/** 편집기가 읽는 모양 그대로. 저장 직후와 최초 로드가 같은 함수를 씁니다. */
export async function loadFormDocument(formId: string) {
  return getPrisma().form.findUnique({
    where: { id: formId },
    include: {
      subject: { select: { id: true, name: true } },
      fields: { orderBy: { position: "asc" }, include: { options: { orderBy: { position: "asc" } } } },
      _count: { select: { responses: true } },
    },
  });
}

/** 그리드 질문은 행과 열이 모두 있어야 응답 화면을 그릴 수 있습니다. 발행 검사에서 함께 씁니다. */
export function gridNeedsRows(field: EditorField) {
  return isGridType(field.type) && "gridRows" in field && field.gridRows.filter((row) => row.trim()).length === 0;
}
