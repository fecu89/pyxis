"use client";

import {
  RATING_MAX,
  type FormFieldType,
  hasOptions,
  isGridType,
} from "@/lib/forms/field-types";
import { keepValidationForType, type EditorField, type EditorOption } from "@/lib/forms/field-schema";
import type { FieldValidation } from "@/lib/forms/validation";
import { parseBranchRules, type BranchRule } from "@/lib/forms/branching";
import type { FormFileType } from "@/lib/forms/field-types";

// 편집기가 들고 있는 질문 하나의 모양과, 그것을 만들고 바꾸는 규칙입니다.
//
// 화면 컴포넌트와 분리한 이유 — "유형을 바꿀 때 무엇을 남기고 무엇을 버리는가"는 JSX 사이에
// 섞여 있으면 읽히지 않는데, 실제로는 이 파일에서 가장 조심해야 하는 부분입니다.

/**
 * DB의 `FormField`에 `clientId`를 더한 것입니다.
 *
 * `id`는 서버가 준 것이라 아직 저장 안 된 질문에는 없습니다. React의 key로 쓰려면 처음부터
 * 있는 안정된 값이 필요해서 `clientId`를 따로 둡니다 — 배열 index를 key로 쓰면 순서를 바꿀 때
 * 입력 중이던 값이 엉뚱한 칸으로 따라갑니다.
 */
export type FieldDraft = {
  id?: string;
  clientId: string;
  type: FormFieldType;
  title: string;
  description: string;
  required: boolean;
  options: EditorOption[];
  shuffleOptions: boolean;
  allowOther: boolean;
  gridRows: string[];
  gridRequireOneResponsePerRow: boolean;
  scaleMin: 0 | 1;
  scaleMax: number;
  scaleMinLabel: string;
  scaleMaxLabel: string;
  ratingMax: number;
  ratingIcon: "STAR" | "HEART" | "THUMB";
  includeYear: boolean;
  includeTime: boolean;
  durationMode: boolean;
  validation: FieldValidation | null;
  branchRules: BranchRule[];
  fileMaxCount: number;
  fileMaxSizeMb: number;
  fileAllowedTypes: FormFileType[];
};

export function clientId() {
  return typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : `draft-${Math.random().toString(36).slice(2)}`;
}

export function blankOption(text = ""): EditorOption {
  return { clientId: clientId(), text };
}

/** 저장 전 보기와 저장된 보기를 같은 방식으로 가리키는 안정 식별자입니다. */
export function optionIdentity(option: Pick<EditorOption, "id" | "clientId">): string | undefined {
  return option.id ?? option.clientId;
}

function defaultOptions(): EditorOption[] {
  return [blankOption("옵션 1"), blankOption("옵션 2")];
}
const DEFAULT_GRID_ROWS = ["1행", "2행"];

export function blankField(type: FormFieldType = "SHORT_TEXT"): FieldDraft {
  return {
    clientId: clientId(),
    type,
    title: "",
    description: "",
    required: false,
    options: hasOptions(type) ? defaultOptions() : [],
    shuffleOptions: false,
    allowOther: false,
    gridRows: isGridType(type) ? [...DEFAULT_GRID_ROWS] : [],
    gridRequireOneResponsePerRow: false,
    scaleMin: 1,
    scaleMax: 5,
    scaleMinLabel: "",
    scaleMaxLabel: "",
    ratingMax: 5,
    ratingIcon: "STAR",
    includeYear: true,
    includeTime: false,
    durationMode: false,
    validation: null,
    branchRules: [],
    fileMaxCount: 1,
    fileMaxSizeMb: 10,
    fileAllowedTypes: ["IMAGE", "PDF", "DOCUMENT"],
  };
}

/**
 * 유형을 바꿉니다. **초기화가 아니라 병합입니다** — 질문 문구와 설명, 필수 여부는 유형과
 * 무관하므로 남기고, 유형 고유의 설정만 기본값으로 되돌립니다. 초기화해 버리면 유형을 잘못
 * 고른 사람이 질문을 다시 타이핑해야 합니다.
 *
 * 보기는 "보기를 가지는 유형끼리" 옮길 때만 유지합니다(객관식 ↔ 체크박스 ↔ 드롭다운).
 * 그리드로 갈 때도 유지합니다 — 그리드의 보기는 곧 열이라 그대로 쓸 수 있습니다.
 */
export function changeFieldType(field: FieldDraft, type: FormFieldType): FieldDraft {
  if (field.type === type) return field;
  const defaults = blankField(type);
  return {
    ...defaults,
    id: field.id,
    clientId: field.clientId,
    title: field.title,
    description: field.description,
    required: field.required,
    options: hasOptions(type)
      ? (hasOptions(field.type) && field.options.length ? field.options : defaults.options)
      : [],
    gridRows: isGridType(type)
      ? (isGridType(field.type) && field.gridRows.length ? field.gridRows : defaults.gridRows)
      : [],
    // 새 유형에 붙을 수 없는 응답 확인은 버립니다. 남겨 두면 저장 스키마에서 거부됩니다.
    validation: keepValidationForType(type, field.validation),
  };
}

/** 서버가 준 문서를 편집기 상태로. null 열은 화면이 다루기 쉬운 기본값으로 채웁니다. */
export function hydrateField(raw: {
  id: string;
  type: string;
  title: string;
  description: string | null;
  required: boolean;
  options: { id: string; text: string }[];
  shuffleOptions: boolean;
  allowOther: boolean;
  gridRows: string[];
  gridRequireOneResponsePerRow: boolean;
  scaleMin: number | null;
  scaleMax: number | null;
  scaleMinLabel: string | null;
  scaleMaxLabel: string | null;
  ratingMax: number | null;
  ratingIcon: string | null;
  includeYear: boolean;
  includeTime: boolean;
  durationMode: boolean;
  validation: unknown;
  branchRules: unknown;
  fileMaxCount: number;
  fileMaxSizeMb: number;
  fileAllowedTypes: string[];
}): FieldDraft {
  const type = raw.type as FormFieldType;
  const defaults = blankField(type);
  return {
    ...defaults,
    id: raw.id,
    clientId: raw.id,
    type,
    title: raw.title,
    description: raw.description ?? "",
    required: raw.required,
    options: raw.options.map((option) => ({ id: option.id, clientId: option.id, text: option.text })),
    shuffleOptions: raw.shuffleOptions,
    allowOther: raw.allowOther,
    gridRows: raw.gridRows,
    gridRequireOneResponsePerRow: raw.gridRequireOneResponsePerRow,
    scaleMin: raw.scaleMin === 0 ? 0 : 1,
    scaleMax: raw.scaleMax ?? defaults.scaleMax,
    scaleMinLabel: raw.scaleMinLabel ?? "",
    scaleMaxLabel: raw.scaleMaxLabel ?? "",
    ratingMax: Math.min(RATING_MAX, raw.ratingMax ?? defaults.ratingMax),
    ratingIcon: (raw.ratingIcon as FieldDraft["ratingIcon"]) ?? defaults.ratingIcon,
    includeYear: raw.includeYear,
    includeTime: raw.includeTime,
    durationMode: raw.durationMode,
    validation: keepValidationForType(type, raw.validation),
    branchRules: parseBranchRules(raw.branchRules),
    fileMaxCount: raw.fileMaxCount,
    fileMaxSizeMb: raw.fileMaxSizeMb,
    fileAllowedTypes: raw.fileAllowedTypes as FormFileType[],
  };
}

/**
 * 저장 요청에 담을 모양으로. **유형에 해당하는 필드만** 넣습니다 — 저장 스키마가
 * `discriminatedUnion`이라 유형에 없는 키가 섞이면 거부됩니다.
 */
export function serializeField(field: FieldDraft): EditorField {
  const base = {
    ...(field.id ? { id: field.id } : {}),
    clientId: field.clientId,
    title: field.title,
    description: field.description.trim() || null,
    required: field.required,
  };
  const options = field.options.map((option) => ({
    ...(option.id ? { id: option.id } : {}),
    ...(option.clientId ? { clientId: option.clientId } : {}),
    text: option.text,
  }));

  switch (field.type) {
    case "SHORT_TEXT":
    case "LONG_TEXT":
      return { ...base, type: field.type, validation: field.validation };
    case "MULTIPLE_CHOICE":
      return { ...base, type: field.type, options, shuffleOptions: field.shuffleOptions, allowOther: field.allowOther, branchRules: field.branchRules };
    case "CHECKBOXES":
      return { ...base, type: field.type, options, shuffleOptions: field.shuffleOptions, allowOther: field.allowOther, validation: field.validation };
    case "DROPDOWN":
      return { ...base, type: field.type, options, shuffleOptions: field.shuffleOptions, branchRules: field.branchRules };
    case "LINEAR_SCALE":
      return { ...base, type: field.type, scaleMin: field.scaleMin, scaleMax: field.scaleMax, scaleMinLabel: field.scaleMinLabel, scaleMaxLabel: field.scaleMaxLabel };
    case "RATING":
      return { ...base, type: field.type, ratingMax: field.ratingMax, ratingIcon: field.ratingIcon };
    case "MULTIPLE_CHOICE_GRID":
    case "CHECKBOX_GRID":
      return { ...base, type: field.type, options, gridRows: field.gridRows, gridRequireOneResponsePerRow: field.gridRequireOneResponsePerRow };
    case "DATE":
      return { ...base, type: field.type, includeYear: field.includeYear, includeTime: field.includeTime };
    case "TIME":
      return { ...base, type: field.type, durationMode: field.durationMode };
    case "FILE_UPLOAD":
      return { ...base, type: field.type, fileMaxCount: field.fileMaxCount, fileMaxSizeMb: field.fileMaxSizeMb, fileAllowedTypes: field.fileAllowedTypes };
    default:
      return { ...base, type: field.type };
  }
}

/** 복제. `id`를 떼고 새 `clientId`를 주어야 서버가 새 질문으로 만듭니다. */
export function duplicateField(field: FieldDraft): FieldDraft {
  const options = field.options.map((option) => blankOption(option.text));
  return {
    ...field,
    id: undefined,
    clientId: clientId(),
    // 배열도 새로 만들어야 복제본을 고칠 때 원본이 함께 바뀌지 않습니다.
    options,
    gridRows: [...field.gridRows],
    // 분기는 섹션당 하나만 허용됩니다. 원본 바로 뒤(같은 섹션)에 생기는 복제본에 규칙까지
    // 복사하면 저장 즉시 문서 전체가 유효하지 않으므로, 보기 내용만 복제하고 분기는 비웁니다.
    branchRules: [],
  };
}
