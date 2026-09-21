import "server-only";

import { Prisma } from "@/generated/prisma/client";
import { getPrisma } from "@/lib/prisma";
import {
  allowsOtherOption,
  formClosedMessage,
  formClosedReason,
  isDisplayOnly,
  isGridType,
  parseGridInputValue,
  type FormClosedReason,
} from "@/lib/forms/field-types";
import { dedupeKeyFor } from "@/lib/forms/guest-access";
import { isAnswerEmpty, validateAnswer, type AnswerValue, type ValidatableField } from "@/lib/forms/validation";
import { parseSignatureStrokes, quantizeSignatureStrokes } from "@/lib/forms/signature";
import type { AnswerInput, SubmitResponseInput } from "@/lib/forms/response-schema";
import { reachableFormFields } from "@/lib/forms/branching";

// 공개 제출 API의 실제 반영 로직입니다. 라우트가 아니라 여기 있는 이유는 lib/forms/save.ts와
// 같습니다 — 알고리즘이 길고, 검증 스크립트가 HTTP 없이 직접 부를 수 있어야 합니다.
//
// 규칙 넷:
//   1. 응답 확인은 서버가 다시 합니다. `validateAnswer`에 실제 보기 ID 목록을 함께 넘겨서,
//      화면을 거치지 않고 보낸 요청도 지워진 보기나 다른 질문의 ID를 담을 수 없게 합니다.
//   2. 스냅샷(fieldType·fieldTitle·selectedOptionTexts·rowLabel)은 클라이언트가 보낸 값이
//      아니라 **이 요청을 처리하는 시점의 FormField·FormFieldOption에서** 직접 채웁니다.
//   3. 정원은 조건부 UPDATE로 확보합니다. "확인 후 증가"의 두 단계로 나누면 마지막 한 자리에
//      동시 요청 두 건이 들어오는 걸 못 막습니다.
//   4. 1인 1응답은 사전 조회가 아니라 유니크 제약 위반(P2002)으로 판정합니다. 사전 조회는 같은
//      순간에 온 두 요청을 둘 다 통과시킵니다 — 설문 링크는 단톡방에 뿌려지므로 실제로 동시에
//      옵니다.

export class FormSubmitError extends Error {}

export class FormNotAcceptingError extends FormSubmitError {
  constructor(readonly reason: FormClosedReason, customMessage?: string | null) {
    super(formClosedMessage(reason, customMessage));
  }
}

export class FormFullError extends FormSubmitError {
  constructor(customMessage?: string | null) {
    super(formClosedMessage("FULL", customMessage));
  }
}

export class DuplicateResponseError extends FormSubmitError {
  constructor() {
    super("이미 응답하셨습니다. 한 사람당 한 번만 응답할 수 있는 설문입니다.");
  }
}

export class FormLoginRequiredError extends FormSubmitError {
  constructor() {
    super("로그인이 필요합니다.");
  }
}

/** 어느 질문에서 막혔는지 편집기(발행 검사)와 같은 모양으로 돌려줍니다 — 화면이 그 질문으로 스크롤합니다. */
export class AnswerValidationError extends FormSubmitError {
  constructor(readonly fieldId: string, readonly fieldIndex: number, message: string) {
    super(message);
  }
}

type FormWithFields = Prisma.FormGetPayload<{
  include: { fields: { include: { options: true }; orderBy: { position: "asc" } } };
}>;
type FieldWithOptions = FormWithFields["fields"][number];

function toValidatableField(field: FieldWithOptions): ValidatableField {
  return {
    type: field.type,
    required: field.required,
    allowOther: field.allowOther,
    optionIds: field.options.map((option) => option.id),
    gridRows: field.gridRows,
    gridRequireOneResponsePerRow: field.gridRequireOneResponsePerRow,
    scaleMin: field.scaleMin,
    scaleMax: field.scaleMax,
    ratingMax: field.ratingMax,
    includeYear: field.includeYear,
    includeTime: field.includeTime,
    durationMode: field.durationMode,
    validation: field.validation,
  };
}

function toAnswerValue(input: AnswerInput | undefined): AnswerValue {
  return {
    textValue: input?.textValue ?? null,
    selectedOptionIds: input?.selectedOptionIds ?? [],
    numberValue: input?.numberValue ?? null,
    dateValue: input?.dateValue ?? null,
    timeValue: input?.timeValue ?? null,
    gridValue: input?.gridValue ?? [],
    signatureStrokes: input?.signatureStrokes ?? [],
    fileIds: input?.fileIds ?? [],
  };
}

/** 문서 전체를 훑어 첫 번째 문제를 돌려줍니다. `lib/forms/field-schema.ts#formCompletionError`와 같은 모양입니다. */
function validateAnswers(fields: FieldWithOptions[], answers: SubmitResponseInput["answers"]): AnswerValidationError | null {
  const reachable = reachableFormFields(fields, answers);
  const legalFieldIds = new Set(reachable.filter((field) => !isDisplayOnly(field.type)).map((field) => field.id));
  if (Object.keys(answers).some((fieldId) => !legalFieldIds.has(fieldId))) {
    throw new FormSubmitError("설문이 바뀌었습니다. 새로고침 후 다시 응답해 주세요.");
  }
  for (const [index, field] of reachable.entries()) {
    if (isDisplayOnly(field.type)) continue;
    const message = validateAnswer(toValidatableField(field), toAnswerValue(answers[field.id]));
    if (message) return new AnswerValidationError(field.id, index, message);
  }
  return null;
}

/**
 * 한 필드의 답을 FormAnswer 생성 데이터로 만듭니다. 비어 있으면(그리고 필수가 아니면) null —
 * 응답하지 않은 선택 항목에 빈 행을 만들지 않습니다. 유형에 안 맞는 열은 채우지 않습니다
 * (lib/forms/save.ts의 필드 정의와 달리, 응답은 한 번 만들어지면 유형이 바뀌지 않으므로 엄격할
 * 필요는 없지만 집계 쿼리가 헷갈리지 않게 관례를 맞춥니다).
 */
function buildAnswerCreate(field: FieldWithOptions, input: AnswerInput | undefined): Prisma.FormAnswerCreateWithoutResponseInput | null {
  if (isDisplayOnly(field.type)) return null;
  const answer = toAnswerValue(input);
  if (isAnswerEmpty(toValidatableField(field), answer)) return null;

  const optionTextById = new Map(field.options.map((option) => [option.id, option.text]));
  const base = {
    field: { connect: { id: field.id } },
    fieldType: field.type,
    fieldTitle: field.title,
  };

  if (field.type === "SHORT_TEXT" || field.type === "LONG_TEXT") {
    return { ...base, textValue: input?.textValue?.trim() || null };
  }

  if (field.type === "MULTIPLE_CHOICE" || field.type === "CHECKBOXES" || field.type === "DROPDOWN") {
    const ids = input?.selectedOptionIds ?? [];
    return {
      ...base,
      selectedOptionIds: ids,
      selectedOptionTexts: ids.map((id) => optionTextById.get(id) ?? ""),
      // "기타"는 보기를 하나도 안 골랐어도 답이 될 수 있습니다(allowsOtherOption).
      textValue: allowsOtherOption(field.type) ? (input?.textValue?.trim() || null) : null,
    };
  }

  if (field.type === "LINEAR_SCALE" || field.type === "RATING") {
    return { ...base, numberValue: input?.numberValue ?? null };
  }

  if (isGridType(field.type)) {
    const rows = parseGridInputValue(input?.gridValue);
    return {
      ...base,
      gridValue: rows.map((row) => ({
        row: row.row,
        rowLabel: field.gridRows[row.row] ?? "",
        optionIds: row.optionIds,
        optionTexts: row.optionIds.map((id) => optionTextById.get(id) ?? ""),
      })),
    };
  }

  if (field.type === "DATE") {
    if (!field.includeYear) return { ...base, dateValue: null, timeValue: input?.dateValue?.trim() || null };
    const parsed = input?.dateValue ? new Date(input.dateValue) : null;
    return { ...base, dateValue: parsed && !Number.isNaN(parsed.getTime()) ? parsed : null, timeValue: null };
  }

  if (field.type === "TIME") {
    return { ...base, timeValue: input?.timeValue?.trim() || null };
  }

  if (field.type === "SIGNATURE") {
    return { ...base, signatureStrokes: quantizeSignatureStrokes(parseSignatureStrokes(input?.signatureStrokes)) };
  }

  if (field.type === "FILE_UPLOAD") return base;

  return null;
}

export type SubmitIdentity = {
  respondentId?: string | null;
  guestTokenHash?: string | null;
};

/**
 * 새 응답을 만듭니다. 라우트가 읽은 설문 객체를 신뢰하지 않고 formId만 받습니다. 조건부
 * UPDATE로 자리를 확보한 뒤 같은 트랜잭션에서 최신 질문·설정을 다시 읽어, 조회 직후 마감이나
 * 편집이 일어난 요청이 낡은 정의로 제출되지 않게 합니다.
 */
export async function submitFormResponse(formId: string, identity: SubmitIdentity, input: SubmitResponseInput) {
  const prisma = getPrisma();
  try {
    return await prisma.$transaction(async (tx) => {
      const now = new Date();
      // 상태·기간·정원 확인과 자리 확보를 DB 한 문장으로 묶습니다. raw SQL을 쓰는 또 다른 이유는
      // 응답 수 증가가 Form.updatedAt(편집 문서 버전)을 갱신하지 않게 하기 위해서입니다.
      const claimed = await tx.$queryRaw<Array<{ id: string }>>(Prisma.sql`
        UPDATE "Form"
        SET "responseCount" = "responseCount" + 1,
            "responseDigestPendingCount" = CASE WHEN "dailyResponseDigestEnabled" THEN "responseDigestPendingCount" + 1 ELSE "responseDigestPendingCount" END,
            "responseDigestPendingSince" = CASE WHEN "dailyResponseDigestEnabled" THEN COALESCE("responseDigestPendingSince", ${now}) ELSE "responseDigestPendingSince" END
        WHERE "id" = ${formId}
          AND "deletedAt" IS NULL
          AND "status" = 'OPEN'
          AND ("openAt" IS NULL OR "openAt" <= ${now})
          AND ("closeAt" IS NULL OR "closeAt" > ${now})
          AND ("maxResponses" IS NULL OR "responseCount" < "maxResponses")
        RETURNING "id"
      `);
      if (!claimed.length) {
        const current = await tx.form.findUnique({ where: { id: formId } });
        const reason = current && !current.deletedAt ? formClosedReason(current, now) : "CLOSED";
        if (reason === "FULL") throw new FormFullError(current?.closedMessage);
        throw new FormNotAcceptingError(reason ?? "CLOSED", current?.closedMessage);
      }

      const form = await tx.form.findUniqueOrThrow({
        where: { id: formId },
        include: { fields: { orderBy: { position: "asc" }, include: { options: { orderBy: { position: "asc" } } } } },
      });
      if (form.requiresLogin && !identity.respondentId) throw new FormLoginRequiredError();

      const answerError = validateAnswers(form.fields, input.answers);
      if (answerError) throw answerError;

      const reachable = reachableFormFields(form.fields, input.answers);
      await validateFileSelections(tx, form.id, reachable, input.answers, identity.respondentId ?? null, null);
      const answers = reachable
        .map((field) => buildAnswerCreate(field, input.answers[field.id]))
        .filter((data): data is Prisma.FormAnswerCreateWithoutResponseInput => data !== null);

      const response = await tx.formResponse.create({
        data: {
          formId: form.id,
          respondentId: identity.respondentId ?? null,
          guestTokenHash: identity.guestTokenHash ?? null,
          respondentName: input.respondentName?.trim() || null,
          dedupeKey: dedupeKeyFor({
            allowMultipleResponses: form.allowMultipleResponses,
            respondentId: identity.respondentId,
            guestTokenHash: identity.guestTokenHash,
          }),
          status: "SUBMITTED",
          submittedAt: new Date(),
          answers: { create: answers },
        },
        select: { id: true, submittedAt: true },
      });
      await attachSelectedFiles(tx, response.id, reachable, input.answers, identity.respondentId ?? null);
      return response;
    });
  } catch (error) {
    if (isDedupeConflict(error)) throw new DuplicateResponseError();
    throw error;
  }
}

/**
 * 기존 응답을 고칩니다. `allowEditAfterSubmit`일 때만 라우트가 부릅니다. 응답을 통째로
 * 지우고 다시 만들지 않고 답변만 지웠다가 다시 만듭니다 — 응답 행 자체(id·제출 시각)는
 * 유지해야 "언제 처음 응답했는지"가 남습니다.
 */
export async function updateFormResponse(formId: string, responseId: string, input: SubmitResponseInput) {
  const prisma = getPrisma();
  return prisma.$transaction(async (tx) => {
    // 편집기 저장·마감과 동시에 진행되면 어느 정의로 수정했는지 불분명해집니다. 공유 잠금으로
    // 현재 수정이 끝날 때까지 Form 정의가 바뀌지 않게 한 뒤 최신 필드를 다시 읽습니다.
    await tx.$queryRaw<Array<{ id: string }>>`
      SELECT "id" FROM "Form" WHERE "id" = ${formId} FOR SHARE
    `;
    const form = await tx.form.findUniqueOrThrow({
      where: { id: formId },
      include: { fields: { orderBy: { position: "asc" }, include: { options: { orderBy: { position: "asc" } } } } },
    });
    const reason = formClosedReason(form);
    if (reason) throw new FormNotAcceptingError(reason, form.closedMessage);
    if (!form.allowEditAfterSubmit) throw new FormSubmitError("이 설문은 제출 후 수정할 수 없습니다.");
    const response = await tx.formResponse.findFirst({ where: { id: responseId, formId }, select: { id: true, respondentId: true } });
    if (!response) throw new FormSubmitError("수정할 응답을 찾을 수 없습니다.");
    const answerError = validateAnswers(form.fields, input.answers);
    if (answerError) throw answerError;

    // 기존 파일을 잠시 미귀속으로 돌린 뒤 새 답변에 다시 연결합니다. 선택에서 빠진 파일은 아래
    // attachSelectedFiles가 건드리지 않아 정리 스위퍼의 대상이 됩니다.
    await tx.formUploadedFile.updateMany({ where: { responseId }, data: { answerId: null, responseId: null } });
    await tx.formAnswer.deleteMany({ where: { responseId } });
    const reachable = reachableFormFields(form.fields, input.answers);
    await validateFileSelections(tx, form.id, reachable, input.answers, response.respondentId, null);
    const answers = reachable
      .map((field) => buildAnswerCreate(field, input.answers[field.id]))
      .filter((data): data is Prisma.FormAnswerCreateWithoutResponseInput => data !== null);
    const updated = await tx.formResponse.update({
      where: { id: responseId },
      data: {
        respondentName: input.respondentName?.trim() || null,
        answers: { create: answers },
      },
      select: { id: true, submittedAt: true },
    });
    await attachSelectedFiles(tx, responseId, reachable, input.answers, response.respondentId);
    return updated;
  });
}

type FormTransaction = Prisma.TransactionClient;

async function validateFileSelections(
  tx: FormTransaction,
  formId: string,
  fields: FieldWithOptions[],
  answers: SubmitResponseInput["answers"],
  uploaderId: string | null,
  answerId: string | null,
) {
  for (const field of fields) {
    if (field.type !== "FILE_UPLOAD") continue;
    const ids = answers[field.id]?.fileIds ?? [];
    if (ids.length > field.fileMaxCount) throw new AnswerValidationError(field.id, field.position, `파일은 ${field.fileMaxCount}개까지만 올릴 수 있습니다.`);
    if (ids.length && !uploaderId) throw new FormLoginRequiredError();
    if (!ids.length) continue;
    const files = await tx.formUploadedFile.findMany({
      where: { id: { in: ids }, formId, fieldId: field.id, uploaderId: uploaderId!, deletedAt: null, answerId },
      select: { id: true, fileSize: true, type: true },
    });
    if (files.length !== ids.length) throw new AnswerValidationError(field.id, field.position, "사용할 수 없는 파일이 포함되어 있습니다.");
    if (files.some((file) => file.fileSize > field.fileMaxSizeMb * 1024 * 1024 || !field.fileAllowedTypes.includes(file.type))) {
      throw new AnswerValidationError(field.id, field.position, "현재 질문의 파일 제한과 맞지 않습니다.");
    }
  }
}

async function attachSelectedFiles(
  tx: FormTransaction,
  responseId: string,
  fields: FieldWithOptions[],
  answers: SubmitResponseInput["answers"],
  uploaderId: string | null,
) {
  for (const field of fields) {
    if (field.type !== "FILE_UPLOAD") continue;
    const ids = answers[field.id]?.fileIds ?? [];
    if (!ids.length) continue;
    const answer = await tx.formAnswer.findUnique({ where: { responseId_fieldId: { responseId, fieldId: field.id } }, select: { id: true } });
    if (!answer) throw new FormSubmitError("파일 답변을 저장하지 못했습니다.");
    const attached = await tx.formUploadedFile.updateMany({
      where: { id: { in: ids }, formId: field.formId, fieldId: field.id, uploaderId: uploaderId!, answerId: null, deletedAt: null },
      data: { responseId, answerId: answer.id },
    });
    if (attached.count !== ids.length) throw new FormSubmitError("파일이 다른 응답에 이미 사용되었습니다.");
  }
}

/**
 * `@@unique([formId, dedupeKey])` 위반인지.
 *
 * 보통은 `error.meta.target`에 컬럼 이름이 배열로 옵니다(`lib/users/nickname.ts`의
 * `isNicknameUniqueConflict`가 그 형태를 봅니다). 그런데 이 프로젝트는 `@prisma/adapter-pg`
 * 드라이버 어댑터를 쓰는데, 그 조합에서는 `target`이 안 채워지고 `meta`가
 * `{ modelName, driverAdapterError }`만 줍니다(실제로 재현해 확인했습니다) — 그래서
 * `target`을 먼저 보되, 없으면 모델 이름으로 판정합니다. `FormResponse`에는 `dedupeKey`
 * 유니크 제약 하나뿐이라(기본키 제외) 모델 이름만으로도 안전합니다.
 */
function isDedupeConflict(error: unknown): boolean {
  if (!(error instanceof Prisma.PrismaClientKnownRequestError) || error.code !== "P2002") return false;
  const target = error.meta?.target;
  if (Array.isArray(target)) return target.includes("dedupeKey");
  if (typeof target === "string") return target.includes("dedupeKey");
  return error.meta?.modelName === "FormResponse";
}
