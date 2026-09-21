"use client";

import { useState, type KeyboardEvent } from "react";
import { ArrowDown, ArrowUp, Archive, Plus, RotateCcw, X } from "lucide-react";
import styles from "@/components/pad/settings/settings.module.css";
import type {
  CustomPostFieldDefinition,
  CustomPostFieldKind,
  PostFieldConfig,
  SystemPostFieldSettings,
} from "@/components/pad/settings/types";

const fieldKindLabel: Record<CustomPostFieldKind, string> = {
  SHORT_TEXT: "단답형",
  LONG_TEXT: "장문형",
  SINGLE_CHOICE: "단일선택",
  MULTIPLE_CHOICE: "다중선택",
};

function fieldKey(id: string) {
  return `field_${id.replaceAll("-", "").slice(0, 16)}`;
}

function optionTokens(raw: string): string[] {
  return raw.split(/[,#\n]/).map((option) => option.trim()).filter(Boolean);
}

// 쉼표·#·Enter를 입력하는 순간 선택지를 시각적인 칩으로 확정합니다. 저장되는 값은 기존과 같은
// string[]이므로 서버 스키마는 바꾸지 않고, 붙여넣기한 "찬성, 보류 # 반대"도 한 번에 나눕니다.
function OptionsInput({ field, onCommit }: { field: CustomPostFieldDefinition; onCommit: (options: string[]) => void }) {
  const [draft, setDraft] = useState("");

  function commitTokens(tokens: string[]) {
    if (!tokens.length) return;
    const next = [...field.options];
    for (const token of tokens) {
      const normalized = token.slice(0, 80);
      if (normalized && !next.includes(normalized) && next.length < 30) next.push(normalized);
    }
    if (next.length !== field.options.length) onCommit(next);
  }

  function commitDraft() {
    commitTokens(optionTokens(draft));
    setDraft("");
  }

  function changeDraft(next: string) {
    if (!/[,#\n]/.test(next)) {
      setDraft(next);
      return;
    }
    const endsWithSeparator = /[,#\n]$/.test(next);
    const parts = next.split(/[,#\n]/);
    const remainder = endsWithSeparator ? "" : parts.pop() ?? "";
    commitTokens(parts.map((option) => option.trim()).filter(Boolean));
    setDraft(remainder);
  }

  function onKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.nativeEvent.isComposing) return;
    if (event.key === "Enter" || event.key === "," || event.key === "#") {
      event.preventDefault();
      commitDraft();
      return;
    }
    if (event.key === "Backspace" && !draft && field.options.length) {
      event.preventDefault();
      onCommit(field.options.slice(0, -1));
    }
  }

  return (
    <div className={styles.optionsField}>
      <div className={styles.optionsLabel}><span>선택지</span><small>{field.options.length}/30</small></div>
      <div className={styles.choiceInput} onClick={(event) => event.currentTarget.querySelector("input")?.focus()}>
        {field.options.map((option) => (
          <span className={styles.choiceChip} key={option}>
            <span>{option}</span>
            <button type="button" aria-label={`${option} 선택지 삭제`} onClick={() => onCommit(field.options.filter((item) => item !== option))}><X size={12} /></button>
          </span>
        ))}
        <input
          className={styles.choiceDraft}
          value={draft}
          aria-label="새 선택지"
          placeholder={field.options.length ? "선택지 추가…" : "입력 후 쉼표·#·Enter"}
          maxLength={80}
          disabled={field.options.length >= 30}
          onChange={(event) => changeDraft(event.target.value)}
          onKeyDown={onKeyDown}
          onBlur={commitDraft}
        />
      </div>
      <small className={styles.optionHint}>쉼표, # 또는 Enter를 누르면 선택지가 칩으로 만들어집니다. 빈 입력에서 Backspace를 누르면 마지막 칩이 지워져요.</small>
    </div>
  );
}

export function PostFieldDesigner({
  value,
  onChange,
}: {
  value: PostFieldConfig;
  onChange: (value: PostFieldConfig) => void;
}) {
  function commit(patch: Partial<PostFieldConfig>) {
    onChange({ ...value, ...patch, version: value.version + 1 });
  }

  function updateSystem(
    name: "title" | "body" | "attachment",
    patch: Partial<SystemPostFieldSettings>,
  ) {
    commit({ [name]: { ...value[name], ...patch } });
  }

  function addField() {
    const id = crypto.randomUUID();
    const next: CustomPostFieldDefinition = {
      id,
      key: fieldKey(id),
      label: "새 질문",
      kind: "SHORT_TEXT",
      required: false,
      position: value.customFields.length,
      options: [],
      version: 1,
      archived: false,
    };
    commit({ customFields: [...value.customFields, next] });
  }

  function updateField(
    fieldId: string,
    patch: Partial<CustomPostFieldDefinition>,
    breaking = false,
  ) {
    commit({
      customFields: value.customFields.map((field) => field.id === fieldId
        ? { ...field, ...patch, version: breaking ? field.version + 1 : field.version }
        : field),
    });
  }

  function moveField(fieldId: string, direction: -1 | 1) {
    const fields = [...value.customFields].sort((left, right) => left.position - right.position);
    const index = fields.findIndex((field) => field.id === fieldId);
    const target = index + direction;
    if (index < 0 || target < 0 || target >= fields.length) return;
    [fields[index], fields[target]] = [fields[target], fields[index]];
    commit({ customFields: fields.map((field, position) => ({ ...field, position })) });
  }

  function systemField(label: string, name: "title" | "body" | "attachment") {
    const field = value[name];
    return (
      <div className={styles.systemField}>
        <div className={styles.systemHeader}>
          <strong>{label}</strong>
          <label className={styles.check}><input type="checkbox" checked={field.visible} onChange={(event) => updateSystem(name, { visible: event.target.checked })} /><span>표시</span></label>
          <label className={styles.check}><input type="checkbox" checked={field.required} disabled={!field.visible} onChange={(event) => updateSystem(name, { required: event.target.checked })} /><span>필수</span></label>
        </div>
        <label>안내 문구<input value={field.placeholder} disabled={!field.visible} maxLength={160} onChange={(event) => updateSystem(name, { placeholder: event.target.value })} /></label>
      </div>
    );
  }

  const orderedFields = [...value.customFields].sort((left, right) => left.position - right.position);
  return (
    <div className={styles.panel}>
      <section className={styles.group}>
        <div className={styles.groupHeader}><strong>기본 게시물 필드</strong></div>
        {systemField("제목", "title")}
        {systemField("본문", "body")}
        {systemField("첨부", "attachment")}
      </section>

      <section className={styles.group}>
        <div className={styles.groupHeader}>
          <strong>사용자 정의 필드</strong>
          <button type="button" className="button soft" onClick={addField}><Plus size={14} />질문 추가</button>
        </div>
        {orderedFields.map((field, index) => (
          <article className={`${styles.customField} ${field.archived ? styles.archived : ""}`} key={field.id}>
            <header className={styles.customHeader}>
              <strong>{field.label || "이름 없는 질문"} · v{field.version}</strong>
              <button type="button" onClick={() => moveField(field.id, -1)} disabled={index === 0} aria-label="앞으로 이동"><ArrowUp size={14} /></button>
              <button type="button" onClick={() => moveField(field.id, 1)} disabled={index === orderedFields.length - 1} aria-label="뒤로 이동"><ArrowDown size={14} /></button>
              <button type="button" onClick={() => updateField(field.id, { archived: !field.archived })} aria-label={field.archived ? "필드 복구" : "필드 보관"}>
                {field.archived ? <RotateCcw size={14} /> : <Archive size={14} />}
              </button>
            </header>
            <div className={styles.grid}>
              <label>질문 이름<input value={field.label} maxLength={80} onChange={(event) => updateField(field.id, { label: event.target.value })} /></label>
              <label>응답 형식
                <select value={field.kind} onChange={(event) => updateField(field.id, { kind: event.target.value as CustomPostFieldKind, options: [] }, true)}>
                  {Object.entries(fieldKindLabel).map(([kind, label]) => <option value={kind} key={kind}>{label}</option>)}
                </select>
              </label>
            </div>
            {(field.kind === "SINGLE_CHOICE" || field.kind === "MULTIPLE_CHOICE") && (
              <OptionsInput key={field.kind} field={field} onCommit={(options) => updateField(field.id, { options })} />
            )}
            <label className={styles.check}><input type="checkbox" checked={field.required} onChange={(event) => updateField(field.id, { required: event.target.checked })} /><span>필수 응답</span></label>
          </article>
        ))}
        {!orderedFields.length && <p className={styles.note}>필요할 때 질문을 추가해 게시물을 활동지처럼 사용할 수 있습니다.</p>}
      </section>
    </div>
  );
}
