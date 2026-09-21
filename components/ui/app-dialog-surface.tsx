"use client";

import { useEffect, useRef, useState } from "react";
import { Modal } from "@/components/ui/modal";
import type { ConfirmOptions, PromptOptions } from "@/components/ui/app-dialog";

export function ConfirmDialogSurface({ options, onDone }: { options: ConfirmOptions; onDone: (ok: boolean) => void }) {
  const danger = options.danger ?? false;
  return (
    <Modal
      open
      onClose={() => onDone(false)}
      title={options.title ?? (danger ? "정말 진행할까요?" : "확인해 주세요")}
      className="confirm-dialog"
    >
      {options.description && <div className="confirm-dialog-body">{options.description}</div>}
      <div className="confirm-dialog-actions">
        <button type="button" className="button soft" onClick={() => onDone(false)}>
          {options.cancelLabel ?? "취소"}
        </button>
        <button type="button" className={`button ${danger ? "danger" : "primary"}`} onClick={() => onDone(true)} autoFocus>
          {options.confirmLabel ?? "확인"}
        </button>
      </div>
    </Modal>
  );
}

export function PromptDialogSurface({ options, onDone }: { options: PromptOptions; onDone: (value: string | null) => void }) {
  const [value, setValue] = useState(options.defaultValue ?? "");
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  useEffect(() => { inputRef.current?.focus(); inputRef.current?.select(); }, []);

  function submit() {
    const trimmed = value.trim();
    const problem = options.validate?.(trimmed) ?? null;
    if (problem) { setError(problem); return; }
    onDone(trimmed);
  }

  return (
    <Modal open onClose={() => onDone(null)} title={options.title} className="confirm-dialog">
      <form className="stack-form" onSubmit={(event) => { event.preventDefault(); submit(); }}>
        {options.description && <div className="confirm-dialog-body">{options.description}</div>}
        <label>
          {options.label ?? "내용"}
          <input
            ref={inputRef}
            value={value}
            onChange={(event) => { setValue(event.target.value); setError(null); }}
            maxLength={options.maxLength ?? 120}
            inputMode={options.inputMode ?? "text"}
            placeholder={options.placeholder}
          />
        </label>
        {error && <p className="form-error" role="alert">{error}</p>}
        <div className="confirm-dialog-actions">
          <button type="button" className="button soft" onClick={() => onDone(null)}>취소</button>
          <button type="submit" className="button primary">{options.confirmLabel ?? "확인"}</button>
        </div>
      </form>
    </Modal>
  );
}
