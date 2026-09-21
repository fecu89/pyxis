import { parseGridValue, type FormFieldType } from "@/lib/forms/field-core";

// 답 하나를 사람이 읽는 한 줄 문자열로 바꿉니다. XLSX 내보내기(lib/forms/xlsx.ts)와 "개별" 탭
// 화면이 **같은 규칙**을 씁니다 — 서명만 예외로, 문자열로 요약할 수 없어 화면은 이 함수를
// 건너뛰고 직접 그립니다(strokesToSvgPath). `server-only`를 붙이지 않는 이유도 그래서입니다.

export type FormattableAnswer = {
  fieldType: FormFieldType;
  textValue: string | null;
  selectedOptionTexts: string[];
  numberValue: number | null;
  dateValue: string | null; // ISO
  timeValue: string | null;
  gridValue: unknown;
  files?: Array<{ originalName: string }>;
};

export function formatAnswerValue(answer: FormattableAnswer): string {
  switch (answer.fieldType) {
    case "SHORT_TEXT":
    case "LONG_TEXT":
      return answer.textValue ?? "";
    case "MULTIPLE_CHOICE":
    case "DROPDOWN":
      // 라디오·드롭다운은 "기타"를 고르면 selectedOptionTexts가 비고 textValue만 찹니다.
      return answer.selectedOptionTexts.length ? answer.selectedOptionTexts.join(", ") : answer.textValue ? `기타: ${answer.textValue}` : "";
    case "CHECKBOXES": {
      const parts = [...answer.selectedOptionTexts];
      if (answer.textValue) parts.push(`기타: ${answer.textValue}`);
      return parts.join(", ");
    }
    case "LINEAR_SCALE":
    case "RATING":
      return answer.numberValue !== null ? String(answer.numberValue) : "";
    case "MULTIPLE_CHOICE_GRID":
    case "CHECKBOX_GRID":
      return parseGridValue(answer.gridValue)
        .map((row) => `${row.rowLabel}: ${row.optionTexts.join(", ") || "(선택 안 함)"}`)
        .join(" / ");
    case "DATE":
      return answer.dateValue ?? answer.timeValue ?? "";
    case "TIME":
      return answer.timeValue ?? "";
    case "SIGNATURE":
      return "(서명 있음)";
    case "FILE_UPLOAD":
      return answer.files?.map((file) => file.originalName).join(", ") || "(첨부 파일)";
    default:
      return "";
  }
}
