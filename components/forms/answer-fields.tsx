"use client";

import dynamic from "next/dynamic";
import { useState } from "react";
import { Check, FileText, Trash2, Upload } from "lucide-react";
import { isGridType, isMultiSelect, parseGridInputValue, type FormFieldType } from "@/lib/forms/field-types";
import type { AnswerInput } from "@/lib/forms/response-schema";
import type { SignatureStrokes } from "@/lib/forms/signature";

// 대부분의 설문에는 서명 문항이 없습니다. 해당 문항이 실제 응답 화면에 있을 때만
// signature_pad와 캔버스 코드를 내려받습니다.
const SignaturePad = dynamic(() => import("@/components/forms/signature-pad").then((mod) => mod.SignaturePad), {
  ssr: false,
  loading: () => <div className="h-44 animate-pulse rounded-lg border border-line bg-surface-muted" aria-label="서명 입력기 불러오는 중" />,
});

// 응답 화면(form-runner.tsx)의 질문 유형별 입력 컴포넌트입니다. 질문을 **만드는**
// components/forms/field-card.tsx와는 반대편 — 여기는 질문에 **답하는** 쪽입니다. 두 화면이
// 유형별로 다른 것을 보여줘야 해서(편집기는 설정, 여기는 입력) 컴포넌트를 나눴습니다.

export type PublicOption = { id: string; text: string };
export type PublicField = {
  id: string;
  type: FormFieldType;
  title: string;
  description: string | null;
  required: boolean;
  imageUrl: string | null;
  imageAlt: string | null;
  options: PublicOption[];
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
};

const RATING_GLYPH: Record<string, string> = { STAR: "★", HEART: "♥", THUMB: "👍" };

export function AnswerField({ field, value, slug, onChange }: {
  field: PublicField;
  value: AnswerInput | undefined;
  slug: string;
  onChange: (patch: AnswerInput) => void;
}) {
  const merge = (patch: AnswerInput) => onChange({ ...value, ...patch });

  if (field.type === "FILE_UPLOAD") {
    return <FileUploadAnswer field={field} slug={slug} fileIds={value?.fileIds ?? []} onChange={(fileIds) => merge({ fileIds })} />;
  }

  if (field.type === "SHORT_TEXT") {
    return (
      <input
        value={value?.textValue ?? ""}
        onChange={(event) => merge({ textValue: event.target.value })}
        maxLength={5000}
        aria-label={field.title}
        className="min-h-11 w-full border-b border-line bg-transparent px-1 text-sm outline-none transition focus:border-brand"
      />
    );
  }

  if (field.type === "LONG_TEXT") {
    return (
      <textarea
        value={value?.textValue ?? ""}
        onChange={(event) => merge({ textValue: event.target.value })}
        maxLength={5000}
        rows={4}
        aria-label={field.title}
        className="w-full rounded-xl border border-line bg-surface px-3 py-2 text-sm outline-none transition focus:border-brand"
      />
    );
  }

  if (field.type === "MULTIPLE_CHOICE" || field.type === "DROPDOWN") {
    if (field.type === "DROPDOWN") {
      return (
        <select
          value={value?.selectedOptionIds?.[0] ?? ""}
          onChange={(event) => merge({ selectedOptionIds: event.target.value ? [event.target.value] : [] })}
          aria-label={field.title}
          className="min-h-11 w-full rounded-xl border border-line bg-surface px-3 text-sm outline-none transition focus:border-brand"
        >
          <option value="">선택 안 함</option>
          {field.options.map((option) => <option key={option.id} value={option.id}>{option.text}</option>)}
        </select>
      );
    }
    return (
      <div role="radiogroup" aria-label={field.title} className="space-y-2">
        {field.options.map((option) => (
          <label key={option.id} className="flex cursor-pointer items-center gap-2.5">
            <input
              type="radio"
              name={field.id}
              checked={value?.selectedOptionIds?.[0] === option.id}
              onChange={() => merge({ selectedOptionIds: [option.id], textValue: "" })}
              className="h-4 w-4 accent-[var(--brand)]"
            />
            <span className="text-sm font-semibold text-content">{option.text}</span>
          </label>
        ))}
        {field.allowOther && (
          <label className="flex items-center gap-2.5">
            <input
              type="radio"
              name={field.id}
              checked={!field.options.some((option) => option.id === value?.selectedOptionIds?.[0]) && Boolean(value?.textValue)}
              onChange={() => merge({ selectedOptionIds: [] })}
              className="h-4 w-4 accent-[var(--brand)]"
            />
            <input
              value={value?.textValue ?? ""}
              onChange={(event) => merge({ selectedOptionIds: [], textValue: event.target.value })}
              placeholder="기타..."
              maxLength={200}
              className="min-h-9 flex-1 border-b border-line bg-transparent px-1 text-sm outline-none focus:border-brand"
            />
          </label>
        )}
      </div>
    );
  }

  if (field.type === "CHECKBOXES") {
    const selected = new Set(value?.selectedOptionIds ?? []);
    function toggle(id: string) {
      const next = new Set(selected);
      if (next.has(id)) next.delete(id); else next.add(id);
      merge({ selectedOptionIds: [...next] });
    }
    return (
      <div role="group" aria-label={field.title} className="space-y-2">
        {field.options.map((option) => (
          <label key={option.id} className="flex cursor-pointer items-center gap-2.5">
            <input type="checkbox" checked={selected.has(option.id)} onChange={() => toggle(option.id)} className="h-4 w-4 accent-[var(--brand)]" />
            <span className="text-sm font-semibold text-content">{option.text}</span>
          </label>
        ))}
        {field.allowOther && (
          <label className="flex items-center gap-2.5">
            <span className="w-4" aria-hidden />
            <input
              value={value?.textValue ?? ""}
              onChange={(event) => merge({ textValue: event.target.value })}
              placeholder="기타..."
              maxLength={200}
              className="min-h-9 flex-1 border-b border-line bg-transparent px-1 text-sm outline-none focus:border-brand"
            />
          </label>
        )}
      </div>
    );
  }

  if (field.type === "LINEAR_SCALE") {
    const min = field.scaleMin ?? 1;
    const max = field.scaleMax ?? 5;
    const steps = Array.from({ length: max - min + 1 }, (_, index) => min + index);
    return (
      <div role="radiogroup" aria-label={field.title} className="flex items-center gap-3">
        {field.scaleMinLabel && <span className="max-w-24 shrink-0 text-xs text-content-muted">{field.scaleMinLabel}</span>}
        <div className="flex flex-1 items-center justify-between gap-1">
          {steps.map((step) => (
            <button
              key={step}
              type="button"
              onClick={() => merge({ numberValue: step })}
              aria-pressed={value?.numberValue === step}
              className={`grid h-10 w-10 shrink-0 place-items-center rounded-full border text-sm font-black transition ${
                value?.numberValue === step ? "border-brand bg-brand text-on-brand" : "border-line bg-surface text-content-muted hover:bg-surface-hover"
              }`}
            >
              {step}
            </button>
          ))}
        </div>
        {field.scaleMaxLabel && <span className="max-w-24 shrink-0 text-xs text-content-muted">{field.scaleMaxLabel}</span>}
      </div>
    );
  }

  if (field.type === "RATING") {
    const max = field.ratingMax ?? 5;
    const glyph = RATING_GLYPH[field.ratingIcon ?? "STAR"] ?? RATING_GLYPH.STAR;
    return (
      <div role="radiogroup" aria-label={field.title} className="flex items-center gap-1">
        {Array.from({ length: max }, (_, index) => index + 1).map((step) => (
          <button
            key={step}
            type="button"
            onClick={() => merge({ numberValue: step })}
            aria-pressed={value?.numberValue === step}
            aria-label={`${step}점`}
            className={`grid h-11 w-11 place-items-center rounded-xl text-2xl transition ${
              (value?.numberValue ?? 0) >= step ? "text-brand" : "text-content-subtle hover:text-brand-300"
            }`}
          >
            {glyph}
          </button>
        ))}
      </div>
    );
  }

  if (isGridType(field.type)) {
    const rows = parseGridInputValue(value?.gridValue);
    const rowFor = (index: number) => rows.find((row) => row.row === index);
    function setCell(rowIndex: number, optionId: string) {
      const multi = isMultiSelect(field.type);
      const current = rowFor(rowIndex)?.optionIds ?? [];
      const next = multi
        ? (current.includes(optionId) ? current.filter((id) => id !== optionId) : [...current, optionId])
        : [optionId];
      const withoutRow = rows.filter((row) => row.row !== rowIndex);
      merge({ gridValue: [...withoutRow, { row: rowIndex, optionIds: next }] });
    }
    return (
      <div className="overflow-x-auto">
        <table className="w-full min-w-[480px] border-collapse text-sm">
          <thead>
            <tr>
              <th className="w-32" />
              {field.options.map((option) => (
                <th key={option.id} className="px-2 pb-2 text-center text-xs font-bold text-content-muted">{option.text}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {field.gridRows.map((row, rowIndex) => (
              <tr key={rowIndex} className="border-t border-line">
                <th scope="row" className="py-2 pr-2 text-left text-xs font-bold text-content">{row}</th>
                {field.options.map((option) => (
                  <td key={option.id} className="px-2 py-2 text-center">
                    <input
                      type={isMultiSelect(field.type) ? "checkbox" : "radio"}
                      name={isMultiSelect(field.type) ? undefined : `${field.id}-${rowIndex}`}
                      checked={(rowFor(rowIndex)?.optionIds ?? []).includes(option.id)}
                      onChange={() => setCell(rowIndex, option.id)}
                      aria-label={`${row} · ${option.text}`}
                      className="h-4 w-4 accent-[var(--brand)]"
                    />
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    );
  }

  if (field.type === "DATE") {
    const inputValue = dateInputValue(value?.dateValue, field.includeYear, field.includeTime);
    return (
      <input
        type={field.includeYear ? (field.includeTime ? "datetime-local" : "date") : "text"}
        inputMode={field.includeYear ? undefined : "numeric"}
        value={inputValue}
        onChange={(event) => merge({ dateValue: dateAnswerValue(event.target.value, field.includeYear, field.includeTime) })}
        placeholder={!field.includeYear ? (field.includeTime ? "MM-DD HH:MM" : "MM-DD") : undefined}
        maxLength={!field.includeYear ? (field.includeTime ? 11 : 5) : undefined}
        aria-label={field.title}
        className="min-h-11 w-full max-w-xs rounded-xl border border-line bg-surface px-3 text-sm outline-none transition focus:border-brand"
      />
    );
  }

  if (field.type === "TIME") {
    return (
      <input
        value={value?.timeValue ?? ""}
        onChange={(event) => merge({ timeValue: event.target.value })}
        placeholder={field.durationMode ? "예: 1:30 (1시간 30분)" : "HH:MM"}
        maxLength={10}
        aria-label={field.title}
        className="min-h-11 w-full max-w-xs rounded-xl border border-line bg-surface px-3 font-mono text-sm outline-none transition focus:border-brand"
      />
    );
  }

  if (field.type === "SIGNATURE") {
    return (
      <SignaturePad
        value={(value?.signatureStrokes as SignatureStrokes | undefined) ?? []}
        onChange={(strokes) => merge({ signatureStrokes: strokes })}
        ariaLabel={field.title}
      />
    );
  }

  return null;
}

function FileUploadAnswer({ field, slug, fileIds, onChange }: {
  field: PublicField;
  slug: string;
  fileIds: string[];
  onChange: (ids: string[]) => void;
}) {
  const [names, setNames] = useState<Record<string, string>>({});
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function upload(file: File) {
    setUploading(true);
    setError(null);
    try {
      const body = new FormData();
      body.append("file", file);
      const response = await fetch(`/api/public/forms/${slug}/fields/${field.id}/files`, { method: "POST", body });
      const data = await response.json().catch(() => ({}));
      if (!response.ok || !data.file?.id) {
        setError(typeof data.error === "string" ? data.error : "파일을 업로드하지 못했습니다.");
        return;
      }
      const id = String(data.file.id);
      setNames((current) => ({ ...current, [id]: String(data.file.originalName || file.name) }));
      onChange([...fileIds, id]);
    } catch {
      setError("네트워크 연결을 확인한 뒤 다시 시도해 주세요.");
    } finally {
      setUploading(false);
    }
  }

  return (
    <div className="space-y-2">
      {fileIds.map((id) => (
        <div key={id} className="flex min-h-10 items-center gap-2 rounded-lg border border-line bg-surface-inset px-3 text-xs font-bold text-content">
          <FileText className="h-4 w-4 shrink-0 text-content-muted" aria-hidden />
          <a href={`/form-files/${id}`} className="min-w-0 flex-1 truncate hover:text-brand">{names[id] ?? "업로드된 파일"}</a>
          <button type="button" onClick={() => onChange(fileIds.filter((value) => value !== id))} className="grid h-8 w-8 place-items-center rounded-lg text-content-subtle hover:bg-danger-soft hover:text-danger" aria-label="파일 제거">
            <Trash2 className="h-4 w-4" aria-hidden />
          </button>
        </div>
      ))}
      {fileIds.length < field.fileMaxCount && (
        <label className="inline-flex min-h-11 cursor-pointer items-center gap-2 rounded-lg border border-line bg-surface px-4 text-sm font-black text-content-muted hover:border-brand hover:text-brand">
          <Upload className="h-4 w-4" aria-hidden />{uploading ? "업로드 중..." : "파일 선택"}
          <input type="file" disabled={uploading} className="sr-only" onChange={(event) => { const file = event.target.files?.[0]; if (file) void upload(file); event.currentTarget.value = ""; }} />
        </label>
      )}
      <p className="text-[11px] text-content-subtle">최대 {field.fileMaxCount}개, 파일당 {field.fileMaxSizeMb}MB · 로그인 필요</p>
      {error && <p role="alert" className="text-xs font-bold text-danger">{error}</p>}
    </div>
  );
}

function dateInputValue(value: string | undefined, includeYear: boolean, includeTime: boolean): string {
  if (!value) return "";
  if (!includeYear) return value.replace("T", " ");
  if (!includeTime) return value.slice(0, 10);
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value.slice(0, 16);
  const offset = date.getTimezoneOffset() * 60_000;
  return new Date(date.getTime() - offset).toISOString().slice(0, 16);
}

function dateAnswerValue(input: string, includeYear: boolean, includeTime: boolean): string {
  if (!input) return "";
  if (!includeYear) return includeTime ? input.replace(" ", "T") : input;
  if (!includeTime) return input;
  const date = new Date(input);
  return Number.isNaN(date.getTime()) ? input : date.toISOString();
}

/** 응답이 채워졌다는 표시. 진행률 표시줄이 "몇 문항 남았는지" 셀 때 씁니다. */
export function AnswerCheckBadge({ done }: { done: boolean }) {
  if (!done) return null;
  return <Check className="h-4 w-4 shrink-0 text-brand" aria-hidden />;
}
