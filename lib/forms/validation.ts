import { z } from "zod";
import {
  TEXT_ANSWER_MAX,
  acceptsValidation,
  isDisplayOnly,
  isGridType,
  isMultiSelect,
  isValidTimeValue,
  parseGridInputValue,
  type FormFieldType,
} from "@/lib/forms/field-types";
import { hasSignature } from "@/lib/forms/signature";

// 구글 설문지의 "응답 확인"과 필수 입력 검사입니다.
//
// **이 파일의 validateAnswer()가 정본입니다.** 편집기 미리보기, 응답 화면의 즉시 오류 표시,
// 제출 API의 최종 검사가 전부 이 함수 하나를 부릅니다. 화면에서만 막고 서버가 다시 안 보면
// 브라우저 검사를 우회한 값이 그대로 저장되고, 반대로 규칙을 두 곳에 손으로 적으면 한쪽만
// 고쳐져서 "화면에서는 통과했는데 제출이 거부되는" 상태가 됩니다.

// ── 규칙 형태 ─────────────────────────────────────────────────────────────────

/** 정규식은 설문 작성자(교사)만 넣지만, 실수로 들어간 중첩 수량자가 응답 서버를 멈추게 하면 안 됩니다. */
export const REGEX_PATTERN_MAX = 200;

export const fieldValidationSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("number"),
    op: z.enum(["gt", "gte", "lt", "lte", "eq", "ne", "between", "notBetween", "isNumber", "isInteger"]),
    value: z.number().finite().optional(),
    value2: z.number().finite().optional(),
  }),
  z.object({
    kind: z.literal("text"),
    op: z.enum(["contains", "notContains", "email", "url"]),
    value: z.string().max(200).optional(),
  }),
  z.object({ kind: z.literal("length"), op: z.enum(["min", "max"]), value: z.number().int().min(1).max(TEXT_ANSWER_MAX) }),
  z.object({ kind: z.literal("regex"), op: z.enum(["matches", "notMatches"]), pattern: z.string().min(1).max(REGEX_PATTERN_MAX) }),
  z.object({ kind: z.literal("count"), op: z.enum(["min", "max", "exact"]), value: z.number().int().min(0) }),
]);

export type FieldValidation = z.infer<typeof fieldValidationSchema>;

/** DB의 Json 컬럼에는 무엇이든 들어올 수 있으므로 읽을 때마다 검증합니다. 깨진 값은 규칙 없음입니다. */
export function parseFieldValidation(value: unknown): FieldValidation | null {
  if (value === null || value === undefined) return null;
  const parsed = fieldValidationSchema.safeParse(value);
  return parsed.success ? parsed.data : null;
}

/** 규칙이 그 유형에 붙을 수 있는지. 편집기가 유형을 바꿀 때 남은 규칙을 버리는 판정에도 씁니다. */
export function validationFitsType(type: FormFieldType, rule: FieldValidation): boolean {
  if (!acceptsValidation(type)) return false;
  if (type === "CHECKBOXES") return rule.kind === "count";
  return rule.kind !== "count";
}

// ── 검사 대상 ─────────────────────────────────────────────────────────────────
// Prisma 모델 전체가 아니라 검사에 필요한 것만 받습니다. 그래야 편집기의 임시 상태(아직 저장
// 안 된 필드)도 같은 함수로 미리 볼 수 있습니다.

export type ValidatableField = {
  type: FormFieldType;
  required: boolean;
  allowOther: boolean;
  /** 이 질문에 실제로 존재하는 보기 ID. 그리드는 **열**이 이 목록입니다. */
  optionIds: readonly string[];
  gridRows: readonly string[];
  gridRequireOneResponsePerRow: boolean;
  scaleMin: number | null;
  scaleMax: number | null;
  ratingMax: number | null;
  includeYear: boolean;
  includeTime: boolean;
  durationMode: boolean;
  validation: unknown;
};

export type AnswerValue = {
  textValue?: string | null;
  selectedOptionIds?: readonly string[];
  numberValue?: number | null;
  /** ISO 문자열 또는 Date. 응답 화면은 문자열로, 서버는 Date로 넘깁니다. */
  dateValue?: string | Date | null;
  timeValue?: string | null;
  gridValue?: unknown;
  signatureStrokes?: unknown;
  fileIds?: readonly string[];
};

// ── 본체 ──────────────────────────────────────────────────────────────────────

/**
 * 응답 한 칸을 검사합니다. 통과하면 null, 아니면 사용자에게 그대로 보여 줄 한국어 문구입니다.
 *
 * 순서가 중요합니다: ① 비었는지 → ② 유형에 맞는 값인지 → ③ 응답 확인 규칙. 비어 있는데
 * 규칙부터 돌리면 선택 안 한 칸에 "숫자를 입력해 주세요"가 뜹니다.
 */
export function validateAnswer(field: ValidatableField, answer: AnswerValue): string | null {
  if (isDisplayOnly(field.type)) return null;

  const empty = isAnswerEmpty(field, answer);
  if (empty) return field.required ? "필수 항목입니다." : null;

  const shapeError = checkShape(field, answer);
  if (shapeError) return shapeError;

  const rule = parseFieldValidation(field.validation);
  if (!rule || !validationFitsType(field.type, rule)) return null;
  return checkRule(field, answer, rule);
}

/** 응답이 비었는지. 필수 검사와 "몇 문항 남았는지" 진행률 표시가 함께 씁니다. */
export function isAnswerEmpty(field: ValidatableField, answer: AnswerValue): boolean {
  switch (field.type) {
    case "SHORT_TEXT":
    case "LONG_TEXT":
      return !answer.textValue?.trim();
    case "MULTIPLE_CHOICE":
    case "CHECKBOXES":
    case "DROPDOWN":
      // "기타"만 적고 보기를 안 고른 경우도 응답으로 봅니다.
      return !(answer.selectedOptionIds?.length ?? 0) && !(field.allowOther && answer.textValue?.trim());
    case "LINEAR_SCALE":
    case "RATING":
      return answer.numberValue === null || answer.numberValue === undefined;
    case "MULTIPLE_CHOICE_GRID":
    case "CHECKBOX_GRID":
      return !parseGridInputValue(answer.gridValue).some((row) => row.optionIds.length > 0);
    case "DATE":
      return !answer.dateValue;
    case "TIME":
      return !answer.timeValue?.trim();
    case "SIGNATURE":
      return !hasSignature(answer.signatureStrokes);
    case "FILE_UPLOAD":
      return !(answer.fileIds?.length ?? 0);
    default:
      return true;
  }
}

/** 유형이 요구하는 형태인지. 화면을 우회해 보낸 값이 여기서 걸립니다. */
function checkShape(field: ValidatableField, answer: AnswerValue): string | null {
  if (field.type === "SHORT_TEXT" || field.type === "LONG_TEXT") {
    if ((answer.textValue ?? "").length > TEXT_ANSWER_MAX) return `${TEXT_ANSWER_MAX}자 이내로 입력해 주세요.`;
    return null;
  }

  if (field.type === "MULTIPLE_CHOICE" || field.type === "DROPDOWN") {
    if ((answer.selectedOptionIds?.length ?? 0) > 1) return "하나만 고를 수 있습니다.";
    return checkSelectedOptionIds(field, answer.selectedOptionIds ?? []);
  }

  // CHECKBOXES는 이 위의 어느 분기와도 안 맞아 예전에는 shape 검사가 통째로 빠져
  // 있었습니다 — 존재하지 않는 보기 ID나 같은 ID 중복도 그냥 통과했다는 뜻입니다.
  if (field.type === "CHECKBOXES") return checkSelectedOptionIds(field, answer.selectedOptionIds ?? []);

  if (field.type === "LINEAR_SCALE") {
    const value = answer.numberValue as number;
    if (!Number.isInteger(value)) return "눈금 중 하나를 골라 주세요.";
    const min = field.scaleMin ?? 1;
    const max = field.scaleMax ?? 5;
    if (value < min || value > max) return `${min}~${max} 사이에서 골라 주세요.`;
    return null;
  }

  if (field.type === "RATING") {
    const value = answer.numberValue as number;
    const max = field.ratingMax ?? 5;
    if (!Number.isInteger(value) || value < 1 || value > max) return `1~${max} 사이에서 골라 주세요.`;
    return null;
  }

  if (field.type === "FILE_UPLOAD") {
    const ids = answer.fileIds ?? [];
    if (ids.length > 10) return "파일은 최대 10개까지 올릴 수 있습니다.";
    if (new Set(ids).size !== ids.length) return "같은 파일이 두 번 들어왔습니다.";
    return null;
  }

  if (isGridType(field.type)) return checkGridShape(field, answer);

  if (field.type === "TIME") {
    if (!isValidTimeValue(answer.timeValue!.trim(), field.durationMode)) {
      return field.durationMode ? "기간을 시:분 형식으로 입력해 주세요." : "시각을 HH:MM 형식으로 입력해 주세요.";
    }
    return null;
  }

  if (field.type === "DATE") {
    if (!isValidDateAnswer(answer.dateValue, field.includeYear, field.includeTime)) return "날짜 형식이 올바르지 않습니다.";
    return null;
  }

  return null;
}

function isValidDateAnswer(value: string | Date | null | undefined, includeYear: boolean, includeTime: boolean): boolean {
  if (value instanceof Date) return !Number.isNaN(value.getTime());
  if (!value) return false;

  if (!includeYear) {
    const match = (includeTime ? /^(\d{2})-(\d{2})T(\d{2}):(\d{2})$/ : /^(\d{2})-(\d{2})$/).exec(value);
    if (!match) return false;
    const month = Number(match[1]);
    const day = Number(match[2]);
    const hour = Number(match[3] ?? 0);
    const minute = Number(match[4] ?? 0);
    return validMonthDay(2000, month, day) && hour <= 23 && minute <= 59;
  }

  if (!includeTime) {
    const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
    return Boolean(match && validMonthDay(Number(match[1]), Number(match[2]), Number(match[3])));
  }

  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::\d{2}(?:\.\d{1,3})?)?(?:Z|[+-]\d{2}:\d{2})$/.exec(value);
  if (!match) return false;
  if (!validMonthDay(Number(match[1]), Number(match[2]), Number(match[3]))) return false;
  if (Number(match[4]) > 23 || Number(match[5]) > 59) return false;
  return !Number.isNaN(new Date(value).getTime());
}

function validMonthDay(year: number, month: number, day: number): boolean {
  if (!Number.isInteger(year) || month < 1 || month > 12 || day < 1) return false;
  return day <= new Date(Date.UTC(year, month, 0)).getUTCDate();
}

/**
 * 선택한 보기 ID들이 실제로 이 질문의 보기인지, 중복은 없는지. 화면을 거치지 않고 직접 보낸
 * 요청은 지워진 보기나 다른 질문의 ID를 담을 수 있는데, 그러면 응답 집계가 존재하지 않는
 * 항목을 세게 됩니다.
 */
function checkSelectedOptionIds(field: ValidatableField, ids: readonly string[]): string | null {
  if (!ids.length) return null;
  if (new Set(ids).size !== ids.length) return "같은 보기가 두 번 들어왔습니다.";
  const legal = new Set(field.optionIds);
  if (ids.some((id) => !legal.has(id))) return "설문이 바뀌었습니다. 새로고침 후 다시 응답해 주세요.";
  return null;
}

function checkGridShape(field: ValidatableField, answer: AnswerValue): string | null {
  const rows = parseGridInputValue(answer.gridValue);
  if (rows.length !== new Set(rows.map((row) => row.row)).size) return "같은 행이 두 번 들어왔습니다.";
  for (const row of rows) {
    if (row.row >= field.gridRows.length) return "설문이 바뀌었습니다. 새로고침 후 다시 응답해 주세요.";
    if (!isMultiSelect(field.type) && row.optionIds.length > 1) return "행마다 하나씩만 고를 수 있습니다.";
    const optionError = checkSelectedOptionIds(field, row.optionIds);
    if (optionError) return optionError;
  }
  // "각 행에 응답 필요"는 필수 여부와 별개입니다 — 응답을 시작했다면 빈 행이 없어야 합니다.
  if (field.gridRequireOneResponsePerRow) {
    const answered = new Set(rows.filter((row) => row.optionIds.length > 0).map((row) => row.row));
    if (answered.size < field.gridRows.length) return "모든 행에 응답해 주세요.";
  }
  return null;
}

function checkRule(field: ValidatableField, answer: AnswerValue, rule: FieldValidation): string | null {
  if (rule.kind === "count") {
    const count = answer.selectedOptionIds?.length ?? 0;
    if (rule.op === "min" && count < rule.value) return `${rule.value}개 이상 골라 주세요.`;
    if (rule.op === "max" && count > rule.value) return `${rule.value}개 이하로 골라 주세요.`;
    if (rule.op === "exact" && count !== rule.value) return `정확히 ${rule.value}개를 골라 주세요.`;
    return null;
  }

  const text = (answer.textValue ?? "").trim();

  if (rule.kind === "length") {
    // 코드 포인트 기준으로 셉니다. 이모지 하나가 2자로 세어지면 사용자가 셈을 못 맞춥니다.
    const length = [...text].length;
    if (rule.op === "min" && length < rule.value) return `${rule.value}자 이상 입력해 주세요.`;
    if (rule.op === "max" && length > rule.value) return `${rule.value}자 이하로 입력해 주세요.`;
    return null;
  }

  if (rule.kind === "text") {
    if (rule.op === "email") return EMAIL_PATTERN.test(text) ? null : "이메일 주소 형식으로 입력해 주세요.";
    if (rule.op === "url") return isHttpUrl(text) ? null : "http로 시작하는 주소를 입력해 주세요.";
    const needle = rule.value ?? "";
    if (rule.op === "contains") return text.includes(needle) ? null : `"${needle}"를 포함해야 합니다.`;
    return text.includes(needle) ? `"${needle}"를 포함할 수 없습니다.` : null;
  }

  if (rule.kind === "regex") {
    const matched = safeRegexTest(rule.pattern, text);
    // 패턴이 깨졌으면 통과시킵니다. 작성자의 실수 때문에 응답자가 영영 제출 못 하는 쪽이 더 나쁩니다.
    if (matched === null) return null;
    if (rule.op === "matches") return matched ? null : "형식이 올바르지 않습니다.";
    return matched ? "허용되지 않는 형식입니다." : null;
  }

  return checkNumberRule(text, rule);
}

function checkNumberRule(text: string, rule: Extract<FieldValidation, { kind: "number" }>): string | null {
  const value = Number(text);
  if (!Number.isFinite(value)) return "숫자를 입력해 주세요.";
  const target = rule.value ?? 0;
  switch (rule.op) {
    case "isNumber": return null;
    case "isInteger": return Number.isInteger(value) ? null : "정수를 입력해 주세요.";
    case "gt": return value > target ? null : `${target}보다 큰 수를 입력해 주세요.`;
    case "gte": return value >= target ? null : `${target} 이상을 입력해 주세요.`;
    case "lt": return value < target ? null : `${target}보다 작은 수를 입력해 주세요.`;
    case "lte": return value <= target ? null : `${target} 이하를 입력해 주세요.`;
    case "eq": return value === target ? null : `${target}을(를) 입력해 주세요.`;
    case "ne": return value !== target ? null : `${target}은(는) 입력할 수 없습니다.`;
    case "between": {
      const [low, high] = sorted(target, rule.value2 ?? target);
      return value >= low && value <= high ? null : `${low}~${high} 사이의 수를 입력해 주세요.`;
    }
    default: {
      const [low, high] = sorted(target, rule.value2 ?? target);
      return value < low || value > high ? null : `${low}~${high} 사이는 입력할 수 없습니다.`;
    }
  }
}

function sorted(a: number, b: number): [number, number] {
  return a <= b ? [a, b] : [b, a];
}

// 이메일은 RFC를 그대로 옮기지 않습니다. 여기서 걸러야 하는 것은 오타(@ 빠짐, 점 빠짐)이지
// 희귀한 합법 주소를 거절하는 것이 아닙니다.
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function isHttpUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
}

/**
 * 중첩 수량자 — `(a+)+`, `(a*)+`, `(a+){2,}` 같은 모양입니다. 이런 패턴은 일치하지 않는 긴
 * 입력에서 Node의 백트래킹 정규식 엔진이 지수 시간을 씁니다. 200자로 문자열을 잘라도
 * 2^200은 사실상 무한이라, 길이 상한만으로는 못 막습니다.
 *
 * 이건 정적 휴리스틱이라 모든 위험한 패턴을 잡지도, 안전한 패턴을 전부 통과시키지도 않습니다.
 * 그래도 새 의존성 없이 흔한 실수(작성자가 실수로 중첩 수량자를 넣는 경우)를 막기엔 충분하고,
 * `safeRegexTest`가 이미 "판정 불가면 통과"이므로 여기서 걸러도 응답자가 막히지 않습니다.
 */
const CATASTROPHIC_REGEX_SHAPE = /\([^)]*[+*][^)]*\)[+*]|\([^)]*[+*][^)]*\)\{\d*,/;

/**
 * 정규식 검사. 패턴이 위험하거나 잘못됐으면 null(판정 불가 → 통과)입니다.
 *
 * 검사 전에 문자열을 잘라 최악의 백트래킹 시간을 묶어 두지만, 200자로도 중첩 수량자는
 * 못 막아서 실행 전에 패턴 모양부터 봅니다.
 */
export function safeRegexTest(pattern: string, value: string): boolean | null {
  if (pattern.length > REGEX_PATTERN_MAX) return null;
  if (CATASTROPHIC_REGEX_SHAPE.test(pattern)) return null;
  try {
    return new RegExp(pattern, "u").test(value.slice(0, 200));
  } catch {
    try {
      return new RegExp(pattern).test(value.slice(0, 200));
    } catch {
      return null;
    }
  }
}
