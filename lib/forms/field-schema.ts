import { z } from "zod";
import {
  FIELD_DESCRIPTION_MAX,
  FIELD_TITLE_MAX,
  GRID_ROW_MAX,
  MAX_FIELDS_PER_FORM,
  MAX_GRID_ROWS,
  MAX_OPTIONS_PER_FIELD,
  OPTION_TEXT_MAX,
  RATING_ICONS,
  RATING_MAX,
  RATING_MIN,
  SCALE_LABEL_MAX,
  SCALE_MAX_MAX,
  SCALE_MAX_MIN,
  FORM_FILE_MAX_COUNT,
  FORM_FILE_MAX_SIZE_MB,
  FORM_FILE_TYPES,
  hasOptions,
  isGridType,
  type FormFieldType,
} from "@/lib/forms/field-types";
import { BRANCH_SUBMIT, branchRulesSchema } from "@/lib/forms/branching";
import { fieldValidationSchema, validationFitsType } from "@/lib/forms/validation";

// 편집기가 보내는 설문 전체 문서의 형태입니다(lib/quiz/question-schema.ts와 같은 구조).
//
// 저장은 필드 단위 API가 아니라 **문서 통째로 PUT**입니다. 순서 바꾸기·유형 전환·보기 추가가
// 한 번의 편집에서 뒤섞이는데, 그걸 필드별 요청으로 쪼개면 중간에 실패했을 때 화면과 DB가
// 서로 다른 상태로 남습니다.

export const FORM_TITLE_MAX = 200;
export const FORM_DESCRIPTION_MAX = 3000;
export const CONFIRMATION_MESSAGE_MAX = 1000;
export const CLOSED_MESSAGE_MAX = 1000;

// 이미지는 파일로 저장되고 이 필드에는 주소만 들어옵니다(POST /api/forms/[formId]/images).
const FORM_IMAGE_PATH = /^\/api\/forms\/[A-Za-z0-9-]+\/images\/[0-9a-f-]{36}\.(?:webp|jpg)$/i;

export const formImageUrlSchema = z
  .string()
  .trim()
  .max(2048, "이미지 주소가 너무 깁니다.")
  .refine((value) => FORM_IMAGE_PATH.test(value) || /^https?:\/\//i.test(value), "지원하지 않는 이미지 주소입니다.");

export const editorOptionSchema = z.object({
  id: z.string().min(1).optional(),
  // 저장 중에도 편집을 계속할 수 있으므로, 아직 DB id가 없는 보기 역시 브라우저에서
  // 안정적인 식별자를 가집니다. 서버는 새 보기의 id로 이 값을 그대로 사용합니다.
  clientId: z.string().min(1).optional(),
  text: z.string().max(OPTION_TEXT_MAX),
});
export type EditorOption = z.infer<typeof editorOptionSchema>;

const sharedFieldFields = {
  id: z.string().min(1).optional(),
  clientId: z.string().min(1).optional(),
  title: z.string().max(FIELD_TITLE_MAX),
  description: z.string().max(FIELD_DESCRIPTION_MAX).nullable(),
  required: z.boolean(),
  imageUrl: formImageUrlSchema.nullable().optional(),
  imageAlt: z.string().max(200).nullable().optional(),
};

const optionListSchema = z.array(editorOptionSchema).min(1).max(MAX_OPTIONS_PER_FIELD);
const gridRowsSchema = z.array(z.string().max(GRID_ROW_MAX)).min(1).max(MAX_GRID_ROWS);
const validationField = fieldValidationSchema.nullable().optional();

export const editorFieldSchema = z.discriminatedUnion("type", [
  z.object({ ...sharedFieldFields, type: z.literal("SHORT_TEXT"), validation: validationField }),
  z.object({ ...sharedFieldFields, type: z.literal("LONG_TEXT"), validation: validationField }),
  z.object({
    ...sharedFieldFields,
    type: z.literal("MULTIPLE_CHOICE"),
    options: optionListSchema,
    shuffleOptions: z.boolean(),
    allowOther: z.boolean(),
    branchRules: branchRulesSchema.optional().default([]),
  }),
  z.object({
    ...sharedFieldFields,
    type: z.literal("CHECKBOXES"),
    options: optionListSchema,
    shuffleOptions: z.boolean(),
    allowOther: z.boolean(),
    validation: validationField,
  }),
  z.object({
    ...sharedFieldFields,
    type: z.literal("DROPDOWN"),
    options: optionListSchema,
    shuffleOptions: z.boolean(),
    branchRules: branchRulesSchema.optional().default([]),
  }),
  z.object({
    ...sharedFieldFields,
    type: z.literal("LINEAR_SCALE"),
    // 구글 설문지와 같이 시작값은 0 또는 1만 고를 수 있습니다.
    scaleMin: z.union([z.literal(0), z.literal(1)]),
    scaleMax: z.number().int().min(SCALE_MAX_MIN).max(SCALE_MAX_MAX),
    scaleMinLabel: z.string().trim().max(SCALE_LABEL_MAX),
    scaleMaxLabel: z.string().trim().max(SCALE_LABEL_MAX),
  }),
  z.object({
    ...sharedFieldFields,
    type: z.literal("RATING"),
    ratingMax: z.number().int().min(RATING_MIN).max(RATING_MAX),
    ratingIcon: z.enum(RATING_ICONS),
  }),
  z.object({
    ...sharedFieldFields,
    type: z.literal("MULTIPLE_CHOICE_GRID"),
    options: optionListSchema, // 열
    gridRows: gridRowsSchema,
    gridRequireOneResponsePerRow: z.boolean(),
  }),
  z.object({
    ...sharedFieldFields,
    type: z.literal("CHECKBOX_GRID"),
    options: optionListSchema,
    gridRows: gridRowsSchema,
    gridRequireOneResponsePerRow: z.boolean(),
  }),
  z.object({ ...sharedFieldFields, type: z.literal("DATE"), includeYear: z.boolean(), includeTime: z.boolean() }),
  z.object({ ...sharedFieldFields, type: z.literal("TIME"), durationMode: z.boolean() }),
  z.object({
    ...sharedFieldFields,
    type: z.literal("FILE_UPLOAD"),
    fileMaxCount: z.number().int().min(1).max(FORM_FILE_MAX_COUNT),
    fileMaxSizeMb: z.number().int().min(1).max(FORM_FILE_MAX_SIZE_MB),
    fileAllowedTypes: z.array(z.enum(FORM_FILE_TYPES)).min(1, "허용할 파일 유형을 1개 이상 선택해 주세요.").max(FORM_FILE_TYPES.length),
  }),
  z.object({ ...sharedFieldFields, type: z.literal("SIGNATURE") }),
  z.object({ ...sharedFieldFields, type: z.literal("SECTION_HEADER") }),
]);

export type EditorField = z.infer<typeof editorFieldSchema>;

// `<input type="datetime-local">`의 값(초·타임존 없는 "YYYY-MM-DDTHH:mm")은 이 스키마를 통과하지
// 못합니다. 편집기가 저장 전에 브라우저 로컬 타임존 기준으로 UTC ISO 문자열로 바꿔서 보냅니다
// (components/forms/form-editor.tsx의 toIsoOrNull). 서버는 항상 완전한 ISO만 받습니다 — 변환
// 규칙을 두 곳에 두면 서머타임 없는 한국이라 지금은 안 어긋나지만, 그 전제에 기대는 대신 한쪽만
// 책임지게 합니다.
const formSaveShape = z.object({
  title: z.string().trim().min(1, "제목을 입력해 주세요.").max(FORM_TITLE_MAX),
  description: z.string().trim().max(FORM_DESCRIPTION_MAX).nullable(),
  subjectName: z.string().trim().max(60).nullable(),
  requiresLogin: z.boolean(),
  allowMultipleResponses: z.boolean(),
  allowEditAfterSubmit: z.boolean(),
  shuffleFields: z.boolean(),
  showProgressBar: z.boolean(),
  confirmationMessage: z.string().trim().max(CONFIRMATION_MESSAGE_MAX).nullable(),
  closedMessage: z.string().trim().max(CLOSED_MESSAGE_MAX).nullable().optional().default(null),
  dailyResponseDigestEnabled: z.boolean().optional().default(true),
  openAt: z.iso.datetime().nullable(),
  closeAt: z.iso.datetime().nullable(),
  maxResponses: z.number().int().min(1).max(100_000).nullable(),
  fields: z.array(editorFieldSchema).min(1, "질문이 1개 이상 있어야 합니다.").max(MAX_FIELDS_PER_FORM),
  /**
   * 응답이 달린 질문을 지우겠다는 명시적 확인입니다. 없으면 저장 API가 그 삭제를 거부합니다 —
   * 응답을 모으는 중에 질문을 지우는 건 되돌릴 수 없는 데이터 손실이라, 편집기가 몇 건이
   * 사라지는지 보여 준 뒤에만 이 플래그를 붙입니다.
   */
  confirmDestructive: z.boolean().optional().default(false),
  /**
   * 낙관적 동시성 잠금입니다. 편집기가 문서를 불러온 시점의 `Form.updatedAt`을 그대로 돌려보내면,
   * 서버는 저장 직전 실제 값과 비교해 다르면 거부합니다(lib/forms/save.ts의 ConflictSaveError) —
   * 다른 탭이나 EDITOR 공유자가 그 사이에 먼저 저장했다는 뜻입니다. `useDocumentSave`의
   * `isCurrent()`는 같은 탭 안의 편집만 보호하므로 별도로 필요합니다. 생략하면 검사를 건너뛰므로
   * `saveFormDocument`를 직접 부르는 검증 스크립트가 매번 이 값을 채우지 않아도 됩니다.
   */
  expectedUpdatedAt: z.iso.datetime().nullable().optional(),
});

export const formSaveSchema = formSaveShape
  .refine(
    (data) => !data.openAt || !data.closeAt || new Date(data.openAt) < new Date(data.closeAt),
    { message: "응답 시작 시각은 마감 시각보다 빨라야 합니다.", path: ["closeAt"] },
  )
  .refine(
    (data) => data.requiresLogin || !data.fields.some((field) => field.type === "FILE_UPLOAD"),
    { message: "파일 업로드 질문이 있는 설문은 로그인이 필요합니다.", path: ["requiresLogin"] },
  );

export type FormSaveInput = z.infer<typeof formSaveSchema>;

// ── 발행 전 완성도 검사 ────────────────────────────────────────────────────────
// 편집기와 발행 API가 **같은 함수**를 부릅니다. 퀴즈는 이 검사가 편집기와 스키마 모듈 양쪽에
// 손으로 중복돼 있어서, 한쪽만 고치면 조용히 어긋납니다.

/** 발행을 막을 이유가 있으면 한국어 문구, 없으면 null입니다. */
export function fieldCompletionError(field: EditorField): string | null {
  if (field.type === "SECTION_HEADER") {
    if (!field.title.trim() && !field.description?.trim()) return "설명 블록에 제목이나 설명을 넣어 주세요.";
    return null;
  }
  if (!field.title.trim()) return "질문 내용이 비어 있습니다.";

  if (hasOptions(field.type)) {
    const options = "options" in field ? field.options : [];
    const filled = options.filter((option) => option.text.trim());
    if (filled.length < 1) return "보기를 한 개 이상 채워 주세요.";
    const unique = new Set(filled.map((option) => option.text.trim()));
    if (unique.size !== filled.length) return "보기는 서로 다른 내용으로 입력해 주세요.";
  }

  if (isGridType(field.type) && "gridRows" in field) {
    const rows = field.gridRows.filter((row) => row.trim());
    if (rows.length < 1) return "행을 한 개 이상 채워 주세요.";
    if (new Set(rows.map((row) => row.trim())).size !== rows.length) return "행은 서로 다른 내용으로 입력해 주세요.";
  }

  if (field.type === "LINEAR_SCALE") {
    if (field.scaleMax <= field.scaleMin) return "척도의 끝 값이 시작 값보다 커야 합니다.";
    if (!field.scaleMinLabel.trim() || !field.scaleMaxLabel.trim()) return "척도 양 끝 라벨을 모두 입력해 주세요.";
  }

  if ("validation" in field && field.validation && !validationFitsType(field.type, field.validation)) {
    return "이 질문 유형에는 붙일 수 없는 응답 확인입니다.";
  }

  return null;
}

/** 문서 전체. 첫 번째 문제만 돌려줍니다 — 편집기가 그 질문으로 스크롤합니다. */
export function formCompletionError(fields: EditorField[]): { index: number; message: string } | null {
  for (const [index, field] of fields.entries()) {
    const message = fieldCompletionError(field);
    if (message) return { index, message };
  }
  // 설명 블록만 있는 설문은 응답을 하나도 받을 수 없습니다.
  if (fields.every((field) => field.type === "SECTION_HEADER")) {
    return { index: 0, message: "응답을 받는 질문이 하나도 없습니다." };
  }
  const fieldKey = (field: EditorField) => field.id ?? field.clientId;
  const sectionPositions = new Map(fields.flatMap((field, index) => (
    field.type === "SECTION_HEADER" && fieldKey(field) ? [[fieldKey(field)!, index] as const] : []
  )));
  let sectionStart = 0;
  let branchedInSection = false;
  for (const [index, field] of fields.entries()) {
    if (field.type === "SECTION_HEADER") {
      sectionStart = index;
      branchedInSection = false;
    }
    if (!(field.type === "MULTIPLE_CHOICE" || field.type === "DROPDOWN") || !field.branchRules.length) continue;
    if (branchedInSection) return { index, message: "한 섹션에는 답변별 이동 질문을 하나만 둘 수 있습니다." };
    branchedInSection = true;
    const optionIds = new Set(field.options.flatMap((option) => {
      const optionId = option.id ?? option.clientId;
      return optionId ? [optionId] : [];
    }));
    if (field.branchRules.some((rule) => !optionIds.has(rule.optionId))) {
      return { index, message: "존재하지 않는 보기에 이동 경로가 지정되어 있습니다." };
    }
    for (const rule of field.branchRules) {
      const targetPosition = rule.destination === BRANCH_SUBMIT ? Number.POSITIVE_INFINITY : sectionPositions.get(rule.destination);
      if (targetPosition === undefined || targetPosition <= sectionStart) {
        return { index, message: "이동 대상은 현재보다 뒤에 있는 섹션이어야 합니다." };
      }
    }
  }
  return null;
}

/** 편집기가 유형을 바꿀 때 새 유형에 안 맞는 응답 확인을 버립니다. */
export function keepValidationForType(type: FormFieldType, validation: unknown) {
  const parsed = fieldValidationSchema.safeParse(validation);
  if (!parsed.success) return null;
  return validationFitsType(type, parsed.data) ? parsed.data : null;
}
