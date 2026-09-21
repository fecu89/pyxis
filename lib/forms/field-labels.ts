import type { FormFieldType } from "@/lib/forms/field-core";

export const FORM_FIELD_TYPE_LABELS: Record<FormFieldType, string> = {
  SHORT_TEXT: "단답형",
  LONG_TEXT: "장문형",
  MULTIPLE_CHOICE: "객관식 질문",
  CHECKBOXES: "체크박스",
  DROPDOWN: "드롭다운",
  LINEAR_SCALE: "선형 배율",
  RATING: "등급",
  MULTIPLE_CHOICE_GRID: "객관식 그리드",
  CHECKBOX_GRID: "체크박스 그리드",
  DATE: "날짜",
  TIME: "시간",
  FILE_UPLOAD: "파일 업로드",
  SIGNATURE: "서명",
  SECTION_HEADER: "설명",
};
