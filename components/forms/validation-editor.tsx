"use client";

import { X } from "lucide-react";
import type { FormFieldType } from "@/lib/forms/field-types";
import type { FieldValidation } from "@/lib/forms/validation";

// 구글 설문지의 "응답 확인". 규칙 자체를 판정하는 코드는 lib/forms/validation.ts에 있고 여기는
// 그 규칙을 고르는 화면만 그립니다.
//
// 규칙 종류가 유형마다 다릅니다 — 체크박스는 "몇 개를 골랐는가"만, 글 입력은 숫자·텍스트·길이·
// 정규식입니다. 유형에 안 맞는 규칙을 만들 수 없게 선택지 자체를 갈라 둡니다.

type Kind = FieldValidation["kind"];

const TEXT_KINDS: { value: Kind; label: string }[] = [
  { value: "number", label: "숫자" },
  { value: "text", label: "텍스트" },
  { value: "length", label: "길이" },
  { value: "regex", label: "정규식" },
];

const OPS: Record<Kind, { value: string; label: string }[]> = {
  number: [
    { value: "gt", label: "초과" }, { value: "gte", label: "이상" },
    { value: "lt", label: "미만" }, { value: "lte", label: "이하" },
    { value: "eq", label: "같음" }, { value: "ne", label: "같지 않음" },
    { value: "between", label: "사이" }, { value: "notBetween", label: "사이가 아님" },
    { value: "isNumber", label: "숫자" }, { value: "isInteger", label: "정수" },
  ],
  text: [
    { value: "contains", label: "포함" }, { value: "notContains", label: "미포함" },
    { value: "email", label: "이메일" }, { value: "url", label: "URL" },
  ],
  length: [{ value: "max", label: "최대 문자 수" }, { value: "min", label: "최소 문자 수" }],
  regex: [{ value: "matches", label: "일치" }, { value: "notMatches", label: "불일치" }],
  count: [{ value: "min", label: "최소 개수" }, { value: "max", label: "최대 개수" }, { value: "exact", label: "정확히" }],
};

/** 종류를 바꿀 때 그 종류의 첫 연산자로 초기화합니다. 이전 연산자를 들고 가면 형태가 깨집니다. */
function defaultRule(kind: Kind): FieldValidation {
  switch (kind) {
    case "number": return { kind: "number", op: "gt", value: 0 };
    case "text": return { kind: "text", op: "contains", value: "" };
    case "length": return { kind: "length", op: "max", value: 100 };
    case "regex": return { kind: "regex", op: "matches", pattern: "" };
    default: return { kind: "count", op: "min", value: 1 };
  }
}

export function ValidationEditor({ type, value, onChange }: {
  type: FormFieldType;
  value: FieldValidation | null;
  onChange: (value: FieldValidation | null) => void;
}) {
  const checkboxOnly = type === "CHECKBOXES";

  if (!value) {
    return (
      <button
        type="button"
        onClick={() => onChange(defaultRule(checkboxOnly ? "count" : "number"))}
        className="inline-flex items-center gap-1.5 rounded-xl px-3 py-2 text-xs font-black text-content-muted transition hover:bg-surface-hover"
      >
        응답 확인 추가
      </button>
    );
  }

  const ops = OPS[value.kind];
  const needsValue = value.kind !== "regex" && !(value.kind === "number" && (value.op === "isNumber" || value.op === "isInteger"))
    && !(value.kind === "text" && (value.op === "email" || value.op === "url"));
  const needsSecond = value.kind === "number" && (value.op === "between" || value.op === "notBetween");

  return (
    <div className="flex flex-wrap items-center gap-2 rounded-xl bg-surface-inset px-3 py-2">
      {!checkboxOnly && (
        <Select
          label="확인 종류"
          value={value.kind}
          options={TEXT_KINDS.map((kind) => ({ value: kind.value, label: kind.label }))}
          onChange={(kind) => onChange(defaultRule(kind as Kind))}
        />
      )}
      <Select
        label="조건"
        value={value.op}
        options={ops}
        onChange={(op) => onChange({ ...value, op } as FieldValidation)}
      />
      {value.kind === "regex" ? (
        <input
          value={value.pattern}
          onChange={(event) => onChange({ ...value, pattern: event.target.value })}
          maxLength={200}
          placeholder="정규식 패턴"
          aria-label="정규식 패턴"
          className="min-h-9 min-w-0 flex-1 rounded-lg border border-line bg-surface px-2 font-mono text-xs outline-none focus:border-brand"
        />
      ) : needsValue ? (
        <>
          <ValueInput
            value={value.kind === "text" ? value.value ?? "" : String("value" in value ? value.value ?? "" : "")}
            numeric={value.kind !== "text"}
            onChange={(next) => onChange(applyValue(value, next, false))}
          />
          {needsSecond && (
            <ValueInput
              value={String(("value2" in value ? value.value2 : undefined) ?? "")}
              numeric
              onChange={(next) => onChange(applyValue(value, next, true))}
            />
          )}
        </>
      ) : null}
      <button
        type="button"
        onClick={() => onChange(null)}
        aria-label="응답 확인 제거"
        className="ml-auto grid h-8 w-8 shrink-0 place-items-center rounded-lg text-content-subtle transition hover:bg-danger-soft hover:text-danger"
      >
        <X className="h-4 w-4" aria-hidden />
      </button>
    </div>
  );
}

function applyValue(rule: FieldValidation, next: string, second: boolean): FieldValidation {
  if (rule.kind === "text") return { ...rule, value: next };
  const parsed = next === "" ? undefined : Number(next);
  if (second) return { ...rule, value2: parsed } as FieldValidation;
  // 길이·개수는 값이 필수라 비면 0으로 둡니다. 저장 스키마가 최소값을 다시 검사합니다.
  return { ...rule, value: parsed ?? 0 } as FieldValidation;
}

function ValueInput({ value, numeric, onChange }: { value: string; numeric: boolean; onChange: (value: string) => void }) {
  return (
    <input
      value={value}
      inputMode={numeric ? "numeric" : "text"}
      onChange={(event) => onChange(event.target.value)}
      maxLength={numeric ? 12 : 200}
      placeholder={numeric ? "값" : "문자열"}
      aria-label={numeric ? "기준 값" : "기준 문자열"}
      className="min-h-9 w-24 rounded-lg border border-line bg-surface px-2 text-xs font-bold outline-none focus:border-brand"
    />
  );
}

function Select({ label, value, options, onChange }: {
  label: string; value: string; options: { value: string; label: string }[]; onChange: (value: string) => void;
}) {
  return (
    <label className="inline-flex items-center gap-1">
      <span className="sr-only">{label}</span>
      <select
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className="min-h-9 rounded-lg border border-line bg-surface px-2 text-xs font-bold text-content outline-none"
      >
        {options.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
      </select>
    </label>
  );
}
