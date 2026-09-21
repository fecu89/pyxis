import type { AnswerInput } from "@/lib/forms/response-schema";
import { parseGridValue } from "@/lib/forms/field-types";
import { parseSignatureStrokes } from "@/lib/forms/signature";

export type EditableFieldRow = {
  id: string; type: string; includeYear: boolean; includeTime: boolean;
  options: Array<{ id: string }>; gridRows: string[];
};

export type EditableAnswerRow = {
  fieldId: string; fieldType: string; textValue: string | null; selectedOptionIds: string[];
  numberValue: number | null; dateValue: Date | null; timeValue: string | null;
  gridValue: unknown; signatureStrokes: unknown; files: Array<{ id: string }>;
};

export function editableAnswers(fields: EditableFieldRow[], rows: EditableAnswerRow[]): Record<string, AnswerInput> {
  const rowByField = new Map(rows.map((row) => [row.fieldId, row]));
  const result: Record<string, AnswerInput> = {};
  for (const field of fields) {
    const row = rowByField.get(field.id);
    if (!row || row.fieldType !== field.type) continue;
    const legalOptions = new Set(field.options.map((option) => option.id));
    if (field.type === "SHORT_TEXT" || field.type === "LONG_TEXT") result[field.id] = { textValue: row.textValue ?? "" };
    else if (field.type === "MULTIPLE_CHOICE" || field.type === "CHECKBOXES" || field.type === "DROPDOWN") {
      result[field.id] = { selectedOptionIds: row.selectedOptionIds.filter((id) => legalOptions.has(id)), ...(row.textValue ? { textValue: row.textValue } : {}) };
    } else if (field.type === "LINEAR_SCALE" || field.type === "RATING") result[field.id] = { numberValue: row.numberValue ?? undefined };
    else if (field.type === "MULTIPLE_CHOICE_GRID" || field.type === "CHECKBOX_GRID") {
      result[field.id] = { gridValue: parseGridValue(row.gridValue).filter((item) => field.gridRows[item.row] === item.rowLabel).map((item) => ({ row: item.row, optionIds: item.optionIds.filter((id) => legalOptions.has(id)) })) };
    } else if (field.type === "DATE") {
      const dateValue = field.includeYear ? row.dateValue?.toISOString() : row.timeValue;
      if (dateValue) result[field.id] = { dateValue };
    } else if (field.type === "TIME") result[field.id] = { timeValue: row.timeValue ?? "" };
    else if (field.type === "SIGNATURE") {
      const strokes = parseSignatureStrokes(row.signatureStrokes);
      if (strokes.length) result[field.id] = { signatureStrokes: strokes };
    } else if (field.type === "FILE_UPLOAD" && row.files.length) result[field.id] = { fileIds: row.files.map((file) => file.id) };
  }
  return result;
}
