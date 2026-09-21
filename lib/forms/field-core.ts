// 설문 필드의 브라우저·서버 공용 상수와 읽기 도구입니다. Zod 스키마와 분리해 결과 보기처럼
// 이미 저장된 값을 표시하기만 하는 화면이 검증 라이브러리 전체를 내려받지 않게 합니다.

export const FORM_FIELD_TYPES = [
  "SHORT_TEXT", "LONG_TEXT", "MULTIPLE_CHOICE", "CHECKBOXES", "DROPDOWN",
  "LINEAR_SCALE", "RATING", "MULTIPLE_CHOICE_GRID", "CHECKBOX_GRID", "DATE",
  "TIME", "FILE_UPLOAD", "SIGNATURE", "SECTION_HEADER",
] as const;
export type FormFieldType = (typeof FORM_FIELD_TYPES)[number];

export const RATING_ICONS = ["STAR", "HEART", "THUMB"] as const;
export type RatingIcon = (typeof RATING_ICONS)[number];
export const FORM_STATUSES = ["DRAFT", "OPEN", "CLOSED"] as const;
export type FormStatus = (typeof FORM_STATUSES)[number];

export const FIELD_TITLE_MAX = 300;
export const FIELD_DESCRIPTION_MAX = 1000;
export const OPTION_TEXT_MAX = 200;
export const GRID_ROW_MAX = 200;
export const TEXT_ANSWER_MAX = 5000;
export const MAX_FIELDS_PER_FORM = 200;
export const MAX_OPTIONS_PER_FIELD = 50;
export const MAX_GRID_ROWS = 30;
export const SCALE_MIN_CHOICES = [0, 1] as const;
export const SCALE_MAX_MIN = 2;
export const SCALE_MAX_MAX = 10;
export const SCALE_LABEL_MAX = 40;
export const RATING_MIN = 3;
export const RATING_MAX = 10;
export const FORM_FILE_MAX_COUNT = 10;
export const FORM_FILE_MAX_SIZE_MB = 30;
export const FORM_FILE_TYPES = ["IMAGE", "PDF", "DOCUMENT", "VIDEO", "AUDIO", "FILE"] as const;
export type FormFileType = (typeof FORM_FILE_TYPES)[number];

export type GridRowAnswer = { row: number; rowLabel: string; optionIds: string[]; optionTexts: string[] };
export type GridValue = GridRowAnswer[];

export function parseGridValue(value: unknown): GridValue {
  if (!Array.isArray(value) || value.length > MAX_GRID_ROWS) return [];
  const rows: GridValue = [];
  for (const raw of value) {
    if (!raw || typeof raw !== "object") return [];
    const row = raw as Record<string, unknown>;
    if (!Number.isInteger(row.row) || Number(row.row) < 0 || Number(row.row) >= MAX_GRID_ROWS) return [];
    if (typeof row.rowLabel !== "string" || row.rowLabel.length > GRID_ROW_MAX) return [];
    if (!isBoundedStrings(row.optionIds, MAX_OPTIONS_PER_FIELD, undefined, true)) return [];
    if (!isBoundedStrings(row.optionTexts, MAX_OPTIONS_PER_FIELD, OPTION_TEXT_MAX, false)) return [];
    rows.push({ row: row.row as number, rowLabel: row.rowLabel, optionIds: row.optionIds, optionTexts: row.optionTexts });
  }
  return rows;
}

function isBoundedStrings(value: unknown, maxItems: number, maxLength: number | undefined, requireNonEmpty: boolean): value is string[] {
  return Array.isArray(value)
    && value.length <= maxItems
    && value.every((item) => typeof item === "string" && (!requireNonEmpty || item.length > 0) && (maxLength === undefined || item.length <= maxLength));
}
