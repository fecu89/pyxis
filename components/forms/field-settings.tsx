"use client";

import { Plus, X } from "lucide-react";
import {
  MAX_GRID_ROWS, RATING_MAX, RATING_MIN, SCALE_LABEL_MAX, SCALE_MAX_MAX, SCALE_MAX_MIN,
} from "@/lib/forms/field-types";
import { insertAfter, removeAt } from "@/lib/editor/list-ops";
import { optionIdentity, type FieldDraft } from "@/components/forms/field-model";
import { BRANCH_SUBMIT } from "@/lib/forms/branching";
import { FORM_FILE_MAX_COUNT, FORM_FILE_MAX_SIZE_MB, FORM_FILE_TYPES, type FormFileType } from "@/lib/forms/field-types";

// 유형 고유 설정 — 선형 배율·등급·그리드 행·날짜/시간. 보기 목록은 option-list-editor.tsx가
// 따로 맡습니다.

export function LinearScaleSettings({ field, onChange }: { field: FieldDraft; onChange: (patch: Partial<FieldDraft>) => void }) {
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2 text-sm font-bold text-content-muted">
        <NumberSelect
          label="시작"
          value={field.scaleMin}
          values={[0, 1]}
          onChange={(value) => onChange({ scaleMin: value === 0 ? 0 : 1 })}
        />
        <span aria-hidden>~</span>
        <NumberSelect
          label="끝"
          value={field.scaleMax}
          values={Array.from({ length: SCALE_MAX_MAX - SCALE_MAX_MIN + 1 }, (_, index) => SCALE_MAX_MIN + index)}
          onChange={(value) => onChange({ scaleMax: value })}
        />
      </div>
      {/* 가운데 눈금에는 라벨을 두지 않습니다 — 10단계에서 화면이 라벨로 가득 차고, 만드는
          사람도 매번 열 개를 채워야 합니다(퀴즈의 리커트와 같은 판단입니다). */}
      <div className="space-y-2">
        <ScaleLabelInput
          prefix={String(field.scaleMin)}
          value={field.scaleMinLabel}
          onChange={(value) => onChange({ scaleMinLabel: value })}
        />
        <ScaleLabelInput
          prefix={String(field.scaleMax)}
          value={field.scaleMaxLabel}
          onChange={(value) => onChange({ scaleMaxLabel: value })}
        />
      </div>
    </div>
  );
}

function ScaleLabelInput({ prefix, value, onChange }: { prefix: string; value: string; onChange: (value: string) => void }) {
  return (
    <div className="flex items-center gap-3">
      <span className="w-6 shrink-0 text-sm font-black text-content">{prefix}</span>
      <input
        value={value}
        onChange={(event) => onChange(event.target.value)}
        maxLength={SCALE_LABEL_MAX}
        placeholder="라벨(선택)"
        aria-label={`${prefix} 라벨`}
        className="min-h-10 min-w-0 flex-1 border-b border-line bg-transparent px-1 text-sm font-semibold outline-none transition focus:border-brand placeholder:text-content-subtle"
      />
    </div>
  );
}

export function RatingSettings({ field, onChange }: { field: FieldDraft; onChange: (patch: Partial<FieldDraft>) => void }) {
  const icons = [
    { value: "STAR", label: "별", glyph: "★" },
    { value: "HEART", label: "하트", glyph: "♥" },
    { value: "THUMB", label: "엄지", glyph: "👍" },
  ] as const;
  return (
    <div className="flex flex-wrap items-center gap-3">
      <NumberSelect
        label="단계"
        value={field.ratingMax}
        values={Array.from({ length: RATING_MAX - RATING_MIN + 1 }, (_, index) => RATING_MIN + index)}
        onChange={(value) => onChange({ ratingMax: value })}
      />
      <div className="flex items-center gap-1" role="radiogroup" aria-label="등급 모양">
        {icons.map((icon) => (
          <button
            key={icon.value}
            type="button"
            role="radio"
            aria-checked={field.ratingIcon === icon.value}
            aria-label={icon.label}
            onClick={() => onChange({ ratingIcon: icon.value })}
            className={`grid h-10 w-10 place-items-center rounded-xl border text-base transition ${
              field.ratingIcon === icon.value
                ? "border-brand bg-brand-soft text-brand-soft-fg"
                : "border-line bg-surface text-content-muted hover:bg-surface-hover"
            }`}
          >
            {icon.glyph}
          </button>
        ))}
      </div>
      <p className="text-xs text-content-subtle">응답자는 1~{field.ratingMax} 중 하나를 고릅니다.</p>
    </div>
  );
}

export function GridRowsEditor({ rows, onChange }: { rows: string[]; onChange: (rows: string[]) => void }) {
  return (
    <div className="space-y-2">
      <p className="text-xs font-black text-content-muted">행</p>
      {rows.map((row, index) => (
        <div key={index} className="flex items-center gap-2">
          <span className="w-5 shrink-0 text-center text-xs font-black text-content-subtle">{index + 1}</span>
          <input
            value={row}
            onChange={(event) => onChange(rows.map((value, rowIndex) => (rowIndex === index ? event.target.value : value)))}
            maxLength={200}
            placeholder={`${index + 1}행`}
            aria-label={`${index + 1}행`}
            className="min-h-10 min-w-0 flex-1 border-b border-line bg-transparent px-1 text-sm font-semibold outline-none transition focus:border-brand placeholder:text-content-subtle"
          />
          <button
            type="button"
            disabled={rows.length <= 1}
            onClick={() => onChange(removeAt(rows, index))}
            aria-label={`${index + 1}행 삭제`}
            className="grid h-9 w-9 shrink-0 place-items-center rounded-xl text-content-subtle transition hover:bg-danger-soft hover:text-danger disabled:opacity-25"
          >
            <X className="h-4 w-4" aria-hidden />
          </button>
        </div>
      ))}
      {rows.length < MAX_GRID_ROWS && (
        <button
          type="button"
          onClick={() => onChange(insertAfter(rows, rows.length - 1, ""))}
          className="inline-flex items-center gap-1.5 rounded-xl px-3 py-2 text-xs font-black text-brand transition hover:bg-brand-soft"
        >
          <Plus className="h-4 w-4" aria-hidden />행 추가
        </button>
      )}
    </div>
  );
}

export function DateTimeSettings({ field, onChange }: { field: FieldDraft; onChange: (patch: Partial<FieldDraft>) => void }) {
  if (field.type === "TIME") {
    return (
      <ToggleRow
        label="시각 대신 기간으로 받기"
        hint="예: 1시간 30분. 24시간을 넘는 값도 넣을 수 있습니다."
        checked={field.durationMode}
        onChange={(value) => onChange({ durationMode: value })}
      />
    );
  }
  return (
    <div className="space-y-1">
      <ToggleRow label="연도 포함" checked={field.includeYear} onChange={(value) => onChange({ includeYear: value })} />
      <ToggleRow label="시간 포함" checked={field.includeTime} onChange={(value) => onChange({ includeTime: value })} />
    </div>
  );
}

export function BranchSettings({ field, sections, onChange }: {
  field: FieldDraft;
  sections: Array<{ id: string; label: string }>;
  onChange: (patch: Partial<FieldDraft>) => void;
}) {
  if (!(field.type === "MULTIPLE_CHOICE" || field.type === "DROPDOWN")) return null;
  const ruleByOption = new Map(field.branchRules.map((rule) => [rule.optionId, rule.destination]));
  const update = (optionId: string, destination: string) => {
    const without = field.branchRules.filter((rule) => rule.optionId !== optionId);
    onChange({ branchRules: destination ? [...without, { optionId, destination }] : without });
  };
  return (
    <div className="space-y-2 rounded-lg bg-surface-inset p-3">
      <p className="text-xs font-black text-content-muted">답변별 이동</p>
      {field.options.map((option, index) => {
        const optionId = optionIdentity(option);
        return (
          <label key={optionId ?? index} className="grid gap-1 text-xs font-bold text-content sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)] sm:items-center">
            <span className="truncate">{option.text || `보기 ${index + 1}`}</span>
            <select
              value={optionId ? ruleByOption.get(optionId) ?? "" : ""}
              disabled={!optionId}
              onChange={(event) => optionId && update(optionId, event.target.value)}
              className="min-h-10 min-w-0 rounded-lg border border-line bg-surface px-2 text-xs outline-none"
            >
              <option value="">다음 섹션으로 계속</option>
              {sections.map((section) => <option key={section.id} value={section.id}>{section.label}</option>)}
              <option value={BRANCH_SUBMIT}>설문 제출</option>
            </select>
          </label>
        );
      })}
    </div>
  );
}

const FILE_TYPE_LABELS: Record<FormFileType, string> = {
  IMAGE: "이미지", PDF: "PDF", DOCUMENT: "문서", VIDEO: "동영상", AUDIO: "오디오", FILE: "기타 파일",
};

export function FileUploadSettings({ field, onChange }: { field: FieldDraft; onChange: (patch: Partial<FieldDraft>) => void }) {
  const selected = new Set(field.fileAllowedTypes);
  const toggle = (type: FormFileType) => {
    const next = selected.has(type) ? field.fileAllowedTypes.filter((value) => value !== type) : [...field.fileAllowedTypes, type];
    if (next.length) onChange({ fileAllowedTypes: next });
  };
  return (
    <div className="space-y-3 rounded-lg bg-surface-inset p-3">
      <div className="flex flex-wrap gap-3">
        <NumberSelect label="최대 파일 수" value={field.fileMaxCount} values={Array.from({ length: FORM_FILE_MAX_COUNT }, (_, i) => i + 1)} onChange={(fileMaxCount) => onChange({ fileMaxCount })} />
        <NumberSelect label="파일당 MB" value={field.fileMaxSizeMb} values={[1, 5, 10, 20, FORM_FILE_MAX_SIZE_MB]} onChange={(fileMaxSizeMb) => onChange({ fileMaxSizeMb })} />
      </div>
      <div className="flex flex-wrap gap-3">
        {FORM_FILE_TYPES.map((type) => (
          <label key={type} className="inline-flex items-center gap-1.5 text-xs font-bold text-content-muted">
            <input type="checkbox" checked={selected.has(type)} onChange={() => toggle(type)} className="h-4 w-4 accent-[var(--brand)]" />
            {FILE_TYPE_LABELS[type]}
          </label>
        ))}
      </div>
    </div>
  );
}

export function ToggleRow({ label, hint, checked, disabled = false, onChange }: {
  label: string; hint?: string; checked: boolean; disabled?: boolean; onChange: (value: boolean) => void;
}) {
  return (
    <label className={`flex items-start gap-2 py-1 ${disabled ? "cursor-not-allowed opacity-60" : "cursor-pointer"}`}>
      <input
        type="checkbox"
        checked={checked}
        disabled={disabled}
        onChange={(event) => onChange(event.target.checked)}
        className="mt-0.5 h-4 w-4 shrink-0 accent-[var(--brand)]"
      />
      <span className="min-w-0">
        <span className="block text-sm font-bold text-content">{label}</span>
        {hint && <span className="block text-xs text-content-subtle">{hint}</span>}
      </span>
    </label>
  );
}

export function NumberSelect({ label, value, values, onChange }: {
  label: string; value: number; values: number[]; onChange: (value: number) => void;
}) {
  return (
    <label className="inline-flex items-center gap-1.5 text-xs font-black text-content-muted">
      {label}
      <select
        value={value}
        onChange={(event) => onChange(Number(event.target.value))}
        className="min-h-10 rounded-xl border border-line bg-surface px-2 text-sm font-bold text-content outline-none"
      >
        {values.map((option) => <option key={option} value={option}>{option}</option>)}
      </select>
    </label>
  );
}
