import { z } from "zod";
import {
  GRID_ROW_MAX,
  MAX_GRID_ROWS,
  MAX_OPTIONS_PER_FIELD,
  OPTION_TEXT_MAX,
  type FormFieldType,
  type FormStatus,
} from "@/lib/forms/field-core";

export {
  FIELD_DESCRIPTION_MAX,
  FIELD_TITLE_MAX,
  FORM_FILE_MAX_COUNT,
  FORM_FILE_MAX_SIZE_MB,
  FORM_FILE_TYPES,
  FORM_FIELD_TYPES,
  FORM_STATUSES,
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
  SCALE_MIN_CHOICES,
  TEXT_ANSWER_MAX,
  parseGridValue,
  type FormFieldType,
  type FormFileType,
  type FormStatus,
  type GridRowAnswer,
  type GridValue,
  type RatingIcon,
} from "@/lib/forms/field-core";

// 설문 필드의 공용 어휘입니다. 편집기 스키마(field-schema.ts)와 응답 검사(validation.ts)가
// 둘 다 여기를 읽습니다 — 서로를 import하면 순환이 되므로 공통 상수만 이 파일에 모읍니다.
//
// `server-only`를 붙이지 않습니다. 응답 확인 규칙은 화면과 제출 API가 **같은 코드**를 써야
// 합니다. 퀴즈는 이 규칙이 편집기와 question-schema.ts 양쪽에 손으로 중복돼 있어서, 한쪽만
// 고치면 "화면에서는 통과했는데 저장이 거부되는" 상태가 만들어집니다.

// ── 유형 판정 ─────────────────────────────────────────────────────────────────
// 여러 곳에서 "이 유형이 보기를 가지는가"를 물으므로 한곳에서 답합니다. 조건을 화면마다
// 나열하면 유형을 하나 추가할 때 빠뜨리는 곳이 반드시 생깁니다.

/** 보기(FormFieldOption)를 가지는 유형. 그리드는 보기가 **열**입니다. */
export function hasOptions(type: FormFieldType): boolean {
  return type === "MULTIPLE_CHOICE" || type === "CHECKBOXES" || type === "DROPDOWN" || isGridType(type);
}

export function isGridType(type: FormFieldType): boolean {
  return type === "MULTIPLE_CHOICE_GRID" || type === "CHECKBOX_GRID";
}

/** 한 칸에 여러 개를 고를 수 있는 유형. 그리드는 "행마다" 여러 개인지를 뜻합니다. */
export function isMultiSelect(type: FormFieldType): boolean {
  return type === "CHECKBOXES" || type === "CHECKBOX_GRID";
}

/** "기타" 자유 입력칸을 붙일 수 있는 유형. 그리드와 드롭다운에는 구글 설문지도 붙이지 않습니다. */
export function allowsOtherOption(type: FormFieldType): boolean {
  return type === "MULTIPLE_CHOICE" || type === "CHECKBOXES";
}

/** 응답을 아예 받지 않는 유형. 필수·응답 확인이 의미가 없습니다. */
export function isDisplayOnly(type: FormFieldType): boolean {
  return type === "SECTION_HEADER";
}

export function supportsBranching(type: FormFieldType): boolean {
  return type === "MULTIPLE_CHOICE" || type === "DROPDOWN";
}

/** "응답 확인"을 붙일 수 있는 유형. */
export function acceptsValidation(type: FormFieldType): boolean {
  return type === "SHORT_TEXT" || type === "LONG_TEXT" || type === "CHECKBOXES";
}

// ── 그리드 응답 ───────────────────────────────────────────────────────────────

/**
 * 그리드 응답은 행마다 답이 하나씩 생겨 열로 펼 수 없습니다. 그리드 전용 응답 테이블을 따로
 * 두면 다른 유형과의 대칭이 깨지므로 FormAnswer.gridValue(Json)에 이 형태로 담습니다.
 *
 * `optionTexts`·`rowLabel`은 응답 시점 스냅샷입니다 — 열이나 행을 나중에 고치거나 지워도(OPEN
 * 중에도 편집이 가능합니다) "무엇을 골랐었는지"가 남습니다. `row`(인덱스)만 저장하면 행을
 * 지우거나 순서를 바꿨을 때 과거 응답이 가리키는 행이 조용히 달라집니다.
 */
export const gridRowAnswerSchema = z.object({
  row: z.number().int().min(0).max(MAX_GRID_ROWS - 1),
  rowLabel: z.string().max(GRID_ROW_MAX),
  optionIds: z.array(z.string().min(1)).max(MAX_OPTIONS_PER_FIELD),
  optionTexts: z.array(z.string().max(OPTION_TEXT_MAX)).max(MAX_OPTIONS_PER_FIELD),
});

export const gridValueSchema = z.array(gridRowAnswerSchema).max(MAX_GRID_ROWS);

/** 응답 화면과 제출 API가 주고받는 형태. 라벨 스냅샷은 서버가 저장 직전에 덧붙입니다. */
export const gridInputValueSchema = z.array(z.object({
  row: z.number().int().min(0).max(MAX_GRID_ROWS - 1),
  optionIds: z.array(z.string().min(1)).max(MAX_OPTIONS_PER_FIELD),
})).max(MAX_GRID_ROWS);

export type GridInputValue = z.infer<typeof gridInputValueSchema>;


/** 아직 저장 전인 그리드 답은 rowLabel/optionTexts가 없으므로 DB 스냅샷 파서와 구분합니다. */
export function parseGridInputValue(value: unknown): GridInputValue {
  const parsed = gridInputValueSchema.safeParse(value);
  return parsed.success ? parsed.data : [];
}

// ── 시각·기간 ─────────────────────────────────────────────────────────────────
// 둘 다 FormAnswer.timeValue 문자열 한 칸에 들어갑니다. DateTime으로 두면 "14:30"에 의미 없는
// 날짜가 따라붙고, 기간(1시간 30분)은 아예 표현되지 않습니다.

/** 하루 중의 시각 "HH:MM". */
export const TIME_OF_DAY_PATTERN = /^([01]\d|2[0-3]):[0-5]\d$/;
/** 기간 "H:MM" — 24시간을 넘을 수 있어 시(hour) 자리 상한을 두지 않습니다(최대 3자리). */
export const DURATION_PATTERN = /^\d{1,3}:[0-5]\d$/;

export function isValidTimeValue(value: string, durationMode: boolean): boolean {
  return durationMode ? DURATION_PATTERN.test(value) : TIME_OF_DAY_PATTERN.test(value);
}

// ── 응답 가능 여부 ────────────────────────────────────────────────────────────
// 화면(`/s/{slug}`)과 제출 API가 같은 판정을 씁니다. 여기 있는 이유는 `lib/forms/access.ts`가
// `server-only`라 응답 화면(클라이언트 컴포넌트)이 못 읽기 때문입니다 — 실제로 한 번
// 번들러가 access.ts를 따라 prisma·pg까지 브라우저 번들에 끌어들이려다 빌드가 깨졌습니다.

export type FormClosedReason = "DRAFT" | "CLOSED" | "NOT_OPEN_YET" | "PAST_DUE" | "FULL";

export const FORM_CLOSED_MESSAGES: Record<FormClosedReason, string> = {
  DRAFT: "아직 발행되지 않은 설문입니다.",
  CLOSED: "마감된 설문입니다.",
  NOT_OPEN_YET: "아직 응답을 받기 전입니다.",
  PAST_DUE: "응답 기간이 지났습니다.",
  FULL: "응답 정원이 모두 찼습니다.",
};

/** 실제로 응답 접수가 끝난 경우만 소유자가 정한 안내를 사용합니다. 초안·시작 전에는 기본 상태 안내가 더 정확합니다. */
export function formClosedMessage(reason: FormClosedReason, customMessage?: string | null): string {
  const ended = reason === "CLOSED" || reason === "PAST_DUE" || reason === "FULL";
  return ended && customMessage?.trim() ? customMessage.trim() : FORM_CLOSED_MESSAGES[reason];
}

type AcceptanceInput = {
  status: FormStatus;
  openAt: Date | null;
  closeAt: Date | null;
  maxResponses: number | null;
  responseCount: number;
};

/**
 * 지금 응답을 받을 수 있는지. 받을 수 없으면 **이유**를 돌려줍니다 — 응답자에게 "열 수
 * 없습니다"만 보여 주면 기다려야 하는지 끝난 것인지 알 수 없습니다.
 */
export function formClosedReason(form: AcceptanceInput, now = new Date()): FormClosedReason | null {
  if (form.status === "DRAFT") return "DRAFT";
  if (form.status === "CLOSED") return "CLOSED";
  if (form.openAt && now < form.openAt) return "NOT_OPEN_YET";
  if (form.closeAt && now > form.closeAt) return "PAST_DUE";
  if (form.maxResponses !== null && form.responseCount >= form.maxResponses) return "FULL";
  return null;
}
