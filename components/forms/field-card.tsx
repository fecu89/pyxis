"use client";

import dynamic from "next/dynamic";
import { Copy, GripVertical, Trash2 } from "lucide-react";
import { acceptsValidation, hasOptions, isDisplayOnly, isGridType } from "@/lib/forms/field-types";
import { fieldCompletionError } from "@/lib/forms/field-schema";
import { optionIdentity, serializeField, type FieldDraft } from "@/components/forms/field-model";
import { FIELD_TYPE_INFO, FieldTypePicker } from "@/components/forms/field-type-picker";
import { DropdownHint, OptionListEditor } from "@/components/forms/option-list-editor";
import { BranchSettings, DateTimeSettings, FileUploadSettings, GridRowsEditor, LinearScaleSettings, RatingSettings, ToggleRow } from "@/components/forms/field-settings";
import { ValidationEditor } from "@/components/forms/validation-editor";

// signature_pad는 서명 문항에서만 필요합니다. 일반 폼 편집 시 캔버스 엔진을 초기 청크에
// 포함하지 않고, 실제 서명 미리보기가 나타날 때 별도 청크로 받습니다.
const SignaturePad = dynamic(() => import("@/components/forms/signature-pad").then((mod) => mod.SignaturePad), {
  ssr: false,
  loading: () => <div className="h-44 animate-pulse rounded-lg border border-line bg-surface-muted" aria-label="서명 입력기 불러오는 중" />,
});

// 질문 카드 하나. 유형별 본문은 아래 FieldBody가 갈라 주고, 이 컴포넌트는 카드의 뼈대(제목·
// 설명·유형·필수·복제·삭제)만 맡습니다.

export function FieldCard({ field, index, total, selected, sectionTargets, onSelect, onChange, onDuplicate, onDelete, dragHandleProps }: {
  field: FieldDraft;
  index: number;
  total: number;
  selected: boolean;
  sectionTargets: Array<{ id: string; label: string }>;
  onSelect: () => void;
  onChange: (patch: Partial<FieldDraft>) => void;
  onDuplicate: () => void;
  onDelete: () => void;
  dragHandleProps: React.HTMLAttributes<HTMLElement>;
}) {
  const incomplete = fieldCompletionError(serializeField(field));

  return (
    <section
      onFocus={onSelect}
      onClick={onSelect}
      aria-label={`${index + 1}번 질문`}
      className={`rounded-2xl border bg-surface transition ${
        selected ? "border-brand shadow-md" : "border-line shadow-sm hover:border-brand-300"
      }`}
    >
      <div
        {...dragHandleProps}
        className="flex cursor-grab touch-none items-center justify-center rounded-t-2xl py-1 text-content-subtle"
        aria-label={`${index + 1}번 질문 순서 변경`}
      >
        <GripVertical className="h-4 w-4 rotate-90" aria-hidden />
      </div>

      <div className="space-y-4 px-4 pb-4">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start">
          <div className="min-w-0 flex-1 space-y-2">
            <input
              value={field.title}
              onChange={(event) => onChange({ title: event.target.value })}
              maxLength={300}
              placeholder={isDisplayOnly(field.type) ? "제목" : "질문"}
              aria-label={`${index + 1}번 질문 내용`}
              className="min-h-11 w-full rounded-lg bg-surface-inset px-3 text-base font-black text-content outline-none transition focus:bg-surface focus:ring-2 focus:ring-brand placeholder:font-bold placeholder:text-content-subtle"
            />
            <input
              value={field.description}
              onChange={(event) => onChange({ description: event.target.value })}
              maxLength={1000}
              placeholder="설명 (선택)"
              aria-label={`${index + 1}번 질문 설명`}
              className="min-h-9 w-full border-b border-transparent bg-transparent px-1 text-sm text-content-muted outline-none transition focus:border-brand placeholder:text-content-subtle"
            />
          </div>
          <FieldTypePicker value={field.type} onChange={(type) => onChange({ type })} />
        </div>

        <FieldBody field={field} sectionTargets={sectionTargets} onChange={onChange} />

        {acceptsValidation(field.type) && (
          <ValidationEditor type={field.type} value={field.validation} onChange={(validation) => onChange({ validation })} />
        )}

        {incomplete && (
          <p role="status" className="text-xs font-bold text-warning-soft-fg">{incomplete}</p>
        )}

        <div className="flex flex-wrap items-center justify-end gap-1 border-t border-line pt-3">
          <button
            type="button"
            onClick={onDuplicate}
            aria-label={`${index + 1}번 질문 복제`}
            className="grid h-10 w-10 place-items-center rounded-xl text-content-muted transition hover:bg-surface-hover"
          >
            <Copy className="h-4 w-4" aria-hidden />
          </button>
          <button
            type="button"
            // 마지막 하나는 지울 수 없습니다. 질문 없는 설문은 저장 스키마가 거부합니다.
            disabled={total <= 1}
            onClick={onDelete}
            aria-label={`${index + 1}번 질문 삭제`}
            className="grid h-10 w-10 place-items-center rounded-xl text-content-muted transition hover:bg-danger-soft hover:text-danger disabled:opacity-30"
          >
            <Trash2 className="h-4 w-4" aria-hidden />
          </button>
          {!isDisplayOnly(field.type) && (
            <div className="ml-1 border-l border-line pl-2">
              <ToggleRow label="필수" checked={field.required} onChange={(required) => onChange({ required })} />
            </div>
          )}
        </div>
      </div>
    </section>
  );
}

/** 유형별 본문. 응답 화면에서 보일 모양을 그대로 보여 주어 따로 미리보기를 열지 않아도 됩니다. */
function FieldBody({ field, sectionTargets, onChange }: { field: FieldDraft; sectionTargets: Array<{ id: string; label: string }>; onChange: (patch: Partial<FieldDraft>) => void }) {
  if (isDisplayOnly(field.type)) return null;

  if (field.type === "SHORT_TEXT" || field.type === "LONG_TEXT") {
    return (
      <p className="border-b border-dashed border-line pb-2 text-sm text-content-subtle">
        {field.type === "SHORT_TEXT" ? "단답형 텍스트" : "장문형 텍스트"}
      </p>
    );
  }

  if (isGridType(field.type)) {
    return (
      <div className="grid gap-4 sm:grid-cols-2">
        <GridRowsEditor rows={field.gridRows} onChange={(gridRows) => onChange({ gridRows })} />
        <div>
          <p className="mb-2 text-xs font-black text-content-muted">열</p>
          <OptionListEditor
            type={field.type}
            options={field.options}
            onChange={(options) => onChange({ options, branchRules: field.branchRules.filter((rule) => options.some((option) => optionIdentity(option) === rule.optionId)) })}
            label="열"
          />
        </div>
        <div className="sm:col-span-2">
          <ToggleRow
            label="각 행에 응답 필요"
            checked={field.gridRequireOneResponsePerRow}
            onChange={(value) => onChange({ gridRequireOneResponsePerRow: value })}
          />
        </div>
      </div>
    );
  }

  if (hasOptions(field.type)) {
    return (
      <div>
        {field.type === "DROPDOWN" && <DropdownHint />}
        <OptionListEditor
          type={field.type}
          options={field.options}
          onChange={(options) => onChange({ options, branchRules: field.branchRules.filter((rule) => options.some((option) => optionIdentity(option) === rule.optionId)) })}
          allowOther={field.allowOther}
          onAllowOtherChange={(allowOther) => onChange({ allowOther })}
        />
        <div className="pt-2">
          <ToggleRow label="보기 순서 섞기" checked={field.shuffleOptions} onChange={(value) => onChange({ shuffleOptions: value })} />
        </div>
        {(field.type === "MULTIPLE_CHOICE" || field.type === "DROPDOWN") && (
          <div className="pt-3"><BranchSettings field={field} sections={sectionTargets} onChange={onChange} /></div>
        )}
      </div>
    );
  }

  if (field.type === "LINEAR_SCALE") return <LinearScaleSettings field={field} onChange={onChange} />;
  if (field.type === "RATING") return <RatingSettings field={field} onChange={onChange} />;
  if (field.type === "DATE" || field.type === "TIME") return <DateTimeSettings field={field} onChange={onChange} />;
  if (field.type === "FILE_UPLOAD") return <FileUploadSettings field={field} onChange={onChange} />;

  if (field.type === "SIGNATURE") {
    return (
      <div className="space-y-2">
        <p className="text-xs text-content-subtle">응답자가 아래 칸에 직접 서명합니다. 편집기에서는 미리보기입니다.</p>
        <SignaturePad value={[]} onChange={() => undefined} disabled />
      </div>
    );
  }

  return <p className="text-sm text-content-subtle">{FIELD_TYPE_INFO[field.type].hint}</p>;
}
