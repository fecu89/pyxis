import type {
  CustomPostFieldDefinition,
  CustomPostFieldKind,
  PostFieldConfig,
  PostFieldValue,
  StoredPostFieldValues,
  SystemPostFieldInput,
  SystemPostFieldSettings,
} from "@/lib/post-fields/types";

const fieldKinds = new Set<CustomPostFieldKind>([
  "SHORT_TEXT",
  "LONG_TEXT",
  "SINGLE_CHOICE",
  "MULTIPLE_CHOICE",
]);
const identifierPattern = /^[A-Za-z0-9_-]{1,80}$/;
const fieldKeyPattern = /^field_[A-Za-z0-9_-]{1,80}$/;

export class PostFieldValidationError extends Error {
  readonly issues: string[];

  constructor(issues: string[]) {
    super(issues[0] || "게시물 필드 값이 올바르지 않습니다.");
    this.name = "PostFieldValidationError";
    this.issues = issues;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readBoolean(source: Record<string, unknown>, key: string, path: string, issues: string[]) {
  const value = source[key];
  if (typeof value === "boolean") return value;
  issues.push(`${path} 값은 boolean이어야 합니다.`);
  return false;
}

function readInteger(
  source: Record<string, unknown>,
  key: string,
  path: string,
  issues: string[],
  minimum: number,
  maximum: number,
) {
  const value = source[key];
  if (Number.isInteger(value) && Number(value) >= minimum && Number(value) <= maximum) return Number(value);
  issues.push(`${path} 값은 ${minimum}~${maximum} 범위의 정수여야 합니다.`);
  return minimum;
}

function readText(
  source: Record<string, unknown>,
  key: string,
  path: string,
  issues: string[],
  maximum: number,
  required = true,
) {
  const value = source[key];
  if (typeof value !== "string") {
    issues.push(`${path} 값은 문자열이어야 합니다.`);
    return "";
  }
  const normalized = value.trim();
  if (required && !normalized) issues.push(`${path} 값을 입력해야 합니다.`);
  if (normalized.length > maximum) issues.push(`${path} 값은 ${maximum}자 이하여야 합니다.`);
  return normalized;
}

function parseSystemField(value: unknown, path: string, issues: string[]): SystemPostFieldSettings {
  if (!isRecord(value)) {
    issues.push(`${path} 설정이 객체가 아닙니다.`);
    value = {};
  }
  const source = value as Record<string, unknown>;
  const visible = readBoolean(source, "visible", `${path}.visible`, issues);
  const required = readBoolean(source, "required", `${path}.required`, issues);
  const placeholder = readText(source, "placeholder", `${path}.placeholder`, issues, 160, false);
  if (!visible && required) issues.push(`${path}를 숨기면서 필수로 설정할 수 없습니다.`);
  return { visible, required, placeholder };
}

function parseCustomField(value: unknown, index: number, issues: string[]): CustomPostFieldDefinition {
  const path = `customFields[${index}]`;
  if (!isRecord(value)) {
    issues.push(`${path} 설정이 객체가 아닙니다.`);
    value = {};
  }
  const source = value as Record<string, unknown>;
  const id = readText(source, "id", `${path}.id`, issues, 80);
  const key = readText(source, "key", `${path}.key`, issues, 86);
  const label = readText(source, "label", `${path}.label`, issues, 80);
  if (id && !identifierPattern.test(id)) issues.push(`${path}.id 형식이 올바르지 않습니다.`);
  if (key && !fieldKeyPattern.test(key)) issues.push(`${path}.key 형식이 올바르지 않습니다.`);

  const rawKind = source.kind;
  const kind = typeof rawKind === "string" && fieldKinds.has(rawKind as CustomPostFieldKind)
    ? rawKind as CustomPostFieldKind
    : "SHORT_TEXT";
  if (kind !== rawKind) issues.push(`${path}.kind 값이 지원되지 않습니다.`);

  const rawOptions = source.options;
  const options: string[] = [];
  if (!Array.isArray(rawOptions)) {
    issues.push(`${path}.options 값은 배열이어야 합니다.`);
  } else {
    if (rawOptions.length > 30) issues.push(`${path}.options는 30개 이하여야 합니다.`);
    rawOptions.slice(0, 30).forEach((option, optionIndex) => {
      if (typeof option !== "string" || !option.trim() || option.trim().length > 80) {
        issues.push(`${path}.options[${optionIndex}]는 1~80자의 문자열이어야 합니다.`);
        return;
      }
      options.push(option.trim());
    });
  }
  if (new Set(options).size !== options.length) issues.push(`${path}.options에 중복 값이 있습니다.`);
  const choiceField = kind === "SINGLE_CHOICE" || kind === "MULTIPLE_CHOICE";
  if (choiceField && options.length < 2) issues.push(`${path} 선택지는 2개 이상이어야 합니다.`);
  if (!choiceField && options.length) issues.push(`${path} 텍스트 필드에는 선택지를 저장할 수 없습니다.`);

  return {
    id,
    key,
    label,
    kind,
    required: readBoolean(source, "required", `${path}.required`, issues),
    position: readInteger(source, "position", `${path}.position`, issues, 0, 10_000),
    options,
    version: readInteger(source, "version", `${path}.version`, issues, 1, 1_000_000),
    archived: readBoolean(source, "archived", `${path}.archived`, issues),
  };
}

export function parsePostFieldConfig(value: unknown): PostFieldConfig {
  const issues: string[] = [];
  if (!isRecord(value)) {
    issues.push("게시물 필드 설정이 객체가 아닙니다.");
    value = {};
  }
  const source = value as Record<string, unknown>;
  const rawFields = Array.isArray(source.customFields) ? source.customFields : [];
  if (!Array.isArray(source.customFields)) issues.push("customFields 값은 배열이어야 합니다.");
  if (rawFields.length > 50) issues.push("사용자 정의 필드는 50개 이하여야 합니다.");
  const customFields = rawFields.slice(0, 50).map((field, index) => parseCustomField(field, index, issues));

  for (const property of ["id", "key", "position"] as const) {
    const values = customFields.map((field) => String(field[property]));
    if (new Set(values).size !== values.length) issues.push(`사용자 정의 필드의 ${property} 값은 중복될 수 없습니다.`);
  }

  const config: PostFieldConfig = {
    version: readInteger(source, "version", "version", issues, 1, 1_000_000),
    title: parseSystemField(source.title, "title", issues),
    body: parseSystemField(source.body, "body", issues),
    attachment: parseSystemField(source.attachment, "attachment", issues),
    customFields,
  };
  if (issues.length) throw new PostFieldValidationError(issues);
  return config;
}

function parseSubmittedValue(
  field: CustomPostFieldDefinition,
  value: unknown,
  issues: string[],
): PostFieldValue | null {
  const path = field.label || field.id;
  if (field.kind === "MULTIPLE_CHOICE") {
    if (!Array.isArray(value) || value.some((item) => typeof item !== "string")) {
      issues.push(`${path} 값은 문자열 배열이어야 합니다.`);
      return null;
    }
    const selected = Array.from(new Set(value as string[]));
    if (selected.length !== value.length) issues.push(`${path} 값에 중복 선택지가 있습니다.`);
    if (selected.some((item) => !field.options.includes(item))) issues.push(`${path} 값에 허용되지 않은 선택지가 있습니다.`);
    if (field.required && !selected.length) issues.push(`${path} 값은 필수입니다.`);
    return selected.length ? selected : null;
  }

  if (typeof value !== "string") {
    issues.push(`${path} 값은 문자열이어야 합니다.`);
    return null;
  }
  const normalized = value.trim();
  if (field.required && !normalized) issues.push(`${path} 값은 필수입니다.`);
  if (field.kind === "SHORT_TEXT" && normalized.length > 500) issues.push(`${path} 값은 500자 이하여야 합니다.`);
  if (field.kind === "LONG_TEXT" && normalized.length > 5_000) issues.push(`${path} 값은 5000자 이하여야 합니다.`);
  if (field.kind === "SINGLE_CHOICE" && normalized && !field.options.includes(normalized)) {
    issues.push(`${path} 값이 허용된 선택지가 아닙니다.`);
  }
  return normalized || null;
}

export function validatePostFieldSubmission(
  config: PostFieldConfig,
  submittedConfigVersion: number,
  value: unknown,
): StoredPostFieldValues {
  const issues: string[] = [];
  if (submittedConfigVersion !== config.version) {
    issues.push("게시물 필드 설정이 변경되었습니다. 작성 폼을 새로 불러와 주세요.");
  }
  if (!isRecord(value)) {
    issues.push("사용자 정의 필드 값이 객체가 아닙니다.");
    value = {};
  }
  const source = value as Record<string, unknown>;
  const activeFields = config.customFields.filter((field) => !field.archived);
  const activeIds = new Set(activeFields.map((field) => field.id));
  for (const fieldId of Object.keys(source)) {
    if (!activeIds.has(fieldId)) issues.push(`알 수 없거나 보관된 필드(${fieldId})가 포함되어 있습니다.`);
  }

  const fields: StoredPostFieldValues["fields"] = {};
  for (const field of activeFields) {
    const submitted = source[field.id];
    if (submitted === undefined) {
      if (field.required) issues.push(`${field.label || field.id} 값은 필수입니다.`);
      continue;
    }
    const parsed = parseSubmittedValue(field, submitted, issues);
    if (parsed !== null) fields[field.id] = { fieldVersion: field.version, value: parsed };
  }
  if (issues.length) throw new PostFieldValidationError(issues);
  return { configVersion: config.version, fields };
}

export function validateSystemPostFields(
  config: PostFieldConfig,
  value: unknown,
  options: { finalizeAttachments?: boolean } = {},
): SystemPostFieldInput {
  const issues: string[] = [];
  if (!isRecord(value)) {
    issues.push("기본 게시물 필드 값이 객체가 아닙니다.");
    value = {};
  }
  const source = value as Record<string, unknown>;
  const title = typeof source.title === "string" ? source.title.trim() : "";
  const body = typeof source.body === "string" ? source.body.trim() : "";
  const attachmentCount = Number.isInteger(source.attachmentCount) && Number(source.attachmentCount) >= 0
    ? Number(source.attachmentCount)
    : 0;
  if (typeof source.title !== "string") issues.push("제목 값은 문자열이어야 합니다.");
  if (typeof source.body !== "string") issues.push("본문 값은 문자열이어야 합니다.");
  if (!Number.isInteger(source.attachmentCount) || attachmentCount > 20) issues.push("첨부 수가 올바르지 않습니다.");
  if (title.length > 200) issues.push("제목은 200자 이하여야 합니다.");
  if (body.length > 20_000) issues.push("본문은 20000자 이하여야 합니다.");
  if (config.title.visible && config.title.required && !title) issues.push("제목은 필수입니다.");
  if (config.body.visible && config.body.required && !body) issues.push("본문은 필수입니다.");
  if (options.finalizeAttachments && config.attachment.visible && config.attachment.required && attachmentCount < 1) {
    issues.push("첨부 파일은 필수입니다.");
  }
  if (issues.length) throw new PostFieldValidationError(issues);
  return { title, body, attachmentCount };
}
