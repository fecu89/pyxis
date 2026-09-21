"use client";

import { CheckSquare, ChevronDown, Circle, Plus, X } from "lucide-react";
import { MAX_OPTIONS_PER_FIELD, allowsOtherOption, isMultiSelect, type FormFieldType } from "@/lib/forms/field-types";
import type { EditorOption } from "@/lib/forms/field-schema";
import { insertAfter, removeAt } from "@/lib/editor/list-ops";
import { blankOption } from "@/components/forms/field-model";

// 객관식·체크박스·드롭다운의 보기 목록. 그리드에서는 **열** 목록으로 같은 컴포넌트를 씁니다.
//
// 보기의 `id`는 절대 건드리지 않습니다. 저장 시 ID가 보존돼야 그 보기를 고른 과거 응답의
// 집계가 살아남습니다(lib/forms/option-bulk-update.ts).

export function OptionListEditor({ type, options, onChange, allowOther, onAllowOtherChange, label = "보기" }: {
  type: FormFieldType;
  options: EditorOption[];
  onChange: (options: EditorOption[]) => void;
  allowOther?: boolean;
  onAllowOtherChange?: (value: boolean) => void;
  label?: string;
}) {
  const multi = isMultiSelect(type);
  const showOther = allowsOtherOption(type) && onAllowOtherChange !== undefined;

  function update(index: number, text: string) {
    onChange(options.map((option, optionIndex) => (optionIndex === index ? { ...option, text } : option)));
  }

  return (
    <div className="space-y-2">
      {options.map((option, index) => (
        <div key={option.id ?? option.clientId ?? `new-${index}`} className="flex items-center gap-2">
          <OptionMarker type={type} index={index} />
          <input
            value={option.text}
            onChange={(event) => update(index, event.target.value)}
            maxLength={200}
            placeholder={`${label} ${index + 1}`}
            aria-label={`${label} ${index + 1}`}
            className="min-h-10 min-w-0 flex-1 border-b border-line bg-transparent px-1 text-sm font-semibold outline-none transition focus:border-brand placeholder:text-content-subtle"
          />
          <button
            type="button"
            // 보기가 하나뿐이면 지울 수 없습니다. 보기 없는 선택형 질문은 응답할 수가 없습니다.
            disabled={options.length <= 1}
            onClick={() => onChange(removeAt(options, index))}
            aria-label={`${label} ${index + 1} 삭제`}
            className="grid h-9 w-9 shrink-0 place-items-center rounded-xl text-content-subtle transition hover:bg-danger-soft hover:text-danger disabled:opacity-25"
          >
            <X className="h-4 w-4" aria-hidden />
          </button>
        </div>
      ))}

      {allowOther && (
        <div className="flex items-center gap-2 opacity-70">
          <OptionMarker type={type} index={options.length} />
          <span className="min-h-10 flex-1 border-b border-dashed border-line px-1 py-2 text-sm font-semibold text-content-subtle">기타...</span>
          <button
            type="button"
            onClick={() => onAllowOtherChange?.(false)}
            aria-label="기타 입력칸 제거"
            className="grid h-9 w-9 shrink-0 place-items-center rounded-xl text-content-subtle transition hover:bg-danger-soft hover:text-danger"
          >
            <X className="h-4 w-4" aria-hidden />
          </button>
        </div>
      )}

      <div className="flex flex-wrap items-center gap-1 pt-1">
        {options.length < MAX_OPTIONS_PER_FIELD && (
          <button
            type="button"
            onClick={() => onChange(insertAfter(options, options.length - 1, blankOption()))}
            className="inline-flex items-center gap-1.5 rounded-xl px-3 py-2 text-xs font-black text-brand transition hover:bg-brand-soft"
          >
            <Plus className="h-4 w-4" aria-hidden />{label} 추가
          </button>
        )}
        {showOther && !allowOther && (
          <button
            type="button"
            onClick={() => onAllowOtherChange?.(true)}
            className="inline-flex items-center gap-1.5 rounded-xl px-3 py-2 text-xs font-black text-content-muted transition hover:bg-surface-hover"
          >
            <Plus className="h-4 w-4" aria-hidden />&apos;기타&apos; 추가
          </button>
        )}
      </div>
      {multi && <p className="text-xs text-content-subtle">응답자는 여러 개를 고를 수 있습니다.</p>}
    </div>
  );
}

/** 보기 앞의 표식. 응답 화면에서 실제로 보일 모양(라디오·체크박스·번호)을 미리 보여 줍니다. */
function OptionMarker({ type, index }: { type: FormFieldType; index: number }) {
  if (type === "DROPDOWN") {
    return <span className="w-5 shrink-0 text-center text-xs font-black text-content-subtle">{index + 1}</span>;
  }
  const Icon = isMultiSelect(type) ? CheckSquare : Circle;
  return <Icon className="h-5 w-5 shrink-0 text-content-subtle" aria-hidden />;
}

/** 드롭다운 미리보기용 화살표. 보기 목록 위에 얹어 유형을 한눈에 알게 합니다. */
export function DropdownHint() {
  return (
    <p className="mb-2 inline-flex items-center gap-1 text-xs font-bold text-content-subtle">
      <ChevronDown className="h-3.5 w-3.5" aria-hidden />펼쳐서 하나를 고릅니다
    </p>
  );
}
