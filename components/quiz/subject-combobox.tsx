"use client";

import { useEffect, useId, useRef, useState, type KeyboardEvent } from "react";

// 교과목 입력 + 제안 목록. 원래는 <input list> + <datalist>였는데, 네이티브 datalist 팝업은
// CSS가 전혀 닿지 않는 브라우저 UI라(흰 시스템 목록·시스템 폰트) 프로젝트 디자인과 겉돌았습니다.
// 같은 동작(직접 입력 + 기존 과목 선택 + 키보드 탐색)을 프로젝트 토큰으로 직접 그립니다.
export function SubjectCombobox({
  value,
  onChange,
  subjects,
  placeholder,
  inputClassName,
  className = "",
  minQueryLength = 0,
  menuPlacement = "bottom",
}: {
  value: string;
  onChange: (value: string) => void;
  subjects: { id: string; name: string }[];
  placeholder?: string;
  /** 호출부의 기존 입력 스타일을 그대로 넘겨받아 주변과 통일합니다. */
  inputClassName: string;
  className?: string;
  /** 이 글자 수 이상 입력했을 때만 제안 목록을 엽니다. 기본값은 기존 동작과 같은 0입니다. */
  minQueryLength?: number;
  /** 스크롤 패널 아래쪽에 놓일 때 목록이 잘리지 않도록 위로 열 수 있습니다. */
  menuPlacement?: "top" | "bottom";
}) {
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(-1);
  const rootRef = useRef<HTMLDivElement>(null);
  const listId = useId();

  const trimmed = value.trim();
  const query = trimmed.toLowerCase();
  const canShowSuggestions = Array.from(trimmed).length >= Math.max(0, minQueryLength);
  const filtered = canShowSuggestions
    ? query
      ? subjects.filter((subject) => subject.name.toLowerCase().includes(query))
      : subjects
    : [];
  const isNewName = canShowSuggestions
    && trimmed.length > 0
    && !subjects.some((subject) => subject.name.toLowerCase() === query);

  useEffect(() => {
    if (!open) return;
    const closeOnOutside = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) {
        setOpen(false);
        setActive(-1);
      }
    };
    window.addEventListener("pointerdown", closeOnOutside);
    return () => window.removeEventListener("pointerdown", closeOnOutside);
  }, [open]);

  function choose(name: string) {
    onChange(name);
    setOpen(false);
    setActive(-1);
  }

  function handleKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (!canShowSuggestions) return;
    if (!open && (event.key === "ArrowDown" || event.key === "ArrowUp")) {
      event.preventDefault();
      setOpen(true);
      setActive(filtered.length ? 0 : -1);
      return;
    }
    if (!open) return;
    if (event.key === "ArrowDown") {
      event.preventDefault();
      setActive((index) => Math.min(filtered.length - 1, index + 1));
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      setActive((index) => Math.max(0, index - 1));
    } else if (event.key === "Enter") {
      // 항목이 강조된 상태의 Enter만 가로챕니다 — 아니면 폼 제출 등 원래 동작 유지.
      if (active >= 0 && filtered[active]) {
        event.preventDefault();
        choose(filtered[active].name);
      } else {
        setOpen(false);
      }
    } else if (event.key === "Escape") {
      setOpen(false);
      setActive(-1);
    }
  }

  return (
    <div ref={rootRef} className={`relative ${className}`}>
      <input
        value={value}
        onChange={(event) => {
          const nextValue = event.target.value;
          onChange(nextValue);
          setOpen(Array.from(nextValue.trim()).length >= Math.max(0, minQueryLength));
          setActive(-1);
        }}
        onFocus={() => setOpen(canShowSuggestions)}
        onKeyDown={handleKeyDown}
        role="combobox"
        aria-expanded={open && canShowSuggestions}
        aria-controls={listId}
        aria-autocomplete="list"
        maxLength={60}
        placeholder={placeholder}
        className={inputClassName}
      />
      {open && canShowSuggestions ? (
        <div
          id={listId}
          role="listbox"
          aria-label="교과목 제안"
          className={`absolute inset-x-0 z-40 max-h-56 overflow-y-auto overscroll-contain rounded-2xl border border-line bg-surface p-1.5 shadow-[0_18px_44px_rgba(15,23,42,.16)] ${menuPlacement === "top" ? "bottom-full mb-2" : "top-full mt-2"}`}
        >
          {filtered.map((subject, index) => (
            <button
              key={subject.id}
              type="button"
              role="option"
              aria-selected={subject.name === trimmed}
              // 클릭이 blur보다 먼저 죽지 않도록 pointerdown 기본 동작(포커스 이동)을 막습니다.
              onPointerDown={(event) => event.preventDefault()}
              onClick={() => choose(subject.name)}
              onMouseEnter={() => setActive(index)}
              className={`flex min-h-10 w-full items-center rounded-xl px-3 text-left text-sm font-bold transition ${index === active ? "bg-brand-soft/60 text-brand-soft-fg" : "text-content-muted hover:bg-surface-muted"}`}
            >
              {subject.name}
            </button>
          ))}
          {isNewName ? (
            <div className="flex min-h-10 items-center rounded-xl px-3 text-xs font-bold text-content-subtle">
              <span className="mr-1.5 rounded-full bg-brand-soft px-2 py-0.5 text-[10px] font-black text-brand-soft-fg">새 과목</span>
              &lsquo;{trimmed}&rsquo; 이(가) 목록에 추가됩니다
            </div>
          ) : null}
          {filtered.length === 0 && !trimmed ? (
            <p className="px-3 py-3 text-xs font-bold text-content-subtle">아직 교과목이 없어요 — 이름을 입력하면 만들어집니다.</p>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
