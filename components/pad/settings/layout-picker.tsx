"use client";

import { useEffect, useId, useRef, useState, type KeyboardEvent } from "react";
import { Check, ChevronDown } from "lucide-react";
import type { PadLayoutKind } from "@/components/pad/layouts/types";
import styles from "@/components/pad/settings/layout-picker.module.css";

type LayoutOption = {
  value: PadLayoutKind;
  label: string;
  description: string;
};

const LAYOUT_OPTIONS: LayoutOption[] = [
  { value: "SECTIONS", label: "열", description: "섹션을 세로 열로 나눠 옆으로 배치" },
  { value: "WALL", label: "담벼락", description: "높이가 다른 카드를 빈틈없이 쌓기" },
  { value: "GRID", label: "격자", description: "같은 폭의 카드를 반응형 격자로 배치" },
  { value: "STREAM", label: "피드", description: "섹션 정보와 글을 세로 흐름으로 읽기" },
  { value: "TIMELINE", label: "타임라인", description: "글을 시간 흐름과 선으로 연결" },
  { value: "TABLE", label: "표", description: "게시물을 행과 열로 한눈에 비교" },
];

// 실제 레이아웃의 핵심 구조만 64×44 좌표 안에 압축한 미리보기입니다. 장식용 그림이 아니라
// 선택지가 화면에서 어떻게 배열되는지 비교하는 도식이라 currentColor와 UI 토큰만 사용합니다.
function LayoutGlyph({ layout }: { layout: PadLayoutKind }) {
  const common = { className: styles.card, rx: 2 };

  return (
    <svg className={styles.glyph} viewBox="0 0 64 44" aria-hidden="true">
      {layout === "SECTIONS" && (
        <>
          <rect x="4" y="4" width="17" height="36" {...common} />
          <rect x="23.5" y="4" width="17" height="36" {...common} />
          <rect x="43" y="4" width="17" height="36" {...common} />
          <rect className={styles.accent} x="7" y="7" width="11" height="5" rx="1.5" />
          <rect className={styles.mutedCard} x="7" y="16" width="11" height="8" rx="1.5" />
          <rect className={styles.mutedCard} x="26.5" y="7" width="11" height="12" rx="1.5" />
          <rect className={styles.mutedCard} x="26.5" y="23" width="11" height="8" rx="1.5" />
          <rect className={styles.mutedCard} x="46" y="7" width="11" height="8" rx="1.5" />
          <rect className={styles.mutedCard} x="46" y="19" width="11" height="14" rx="1.5" />
        </>
      )}

      {layout === "WALL" && (
        <>
          <rect x="4" y="4" width="26" height="14" {...common} />
          <rect x="34" y="4" width="26" height="22" {...common} />
          <rect x="4" y="22" width="26" height="18" {...common} />
          <rect x="34" y="30" width="26" height="10" {...common} />
          <rect className={styles.accent} x="7" y="7" width="13" height="3" rx="1.5" />
          <path className={styles.line} d="M37 8h17M37 12h12M7 26h17M7 30h12M37 34h15" />
        </>
      )}

      {layout === "GRID" && (
        <>
          <rect x="4" y="4" width="26" height="16" {...common} />
          <rect x="34" y="4" width="26" height="16" {...common} />
          <rect x="4" y="24" width="26" height="16" {...common} />
          <rect x="34" y="24" width="26" height="16" {...common} />
          <rect className={styles.accent} x="7" y="7" width="8" height="4" rx="1.5" />
          <path className={styles.line} d="M7 15h17M37 9h17M37 14h12M7 29h17M7 34h12M37 29h17M37 34h15" />
        </>
      )}

      {layout === "STREAM" && (
        <>
          <circle className={styles.accent} cx="8" cy="9" r="3" />
          <circle className={styles.accent} cx="8" cy="22" r="3" />
          <circle className={styles.accent} cx="8" cy="35" r="3" />
          <rect x="17" y="4" width="43" height="10" {...common} />
          <rect x="17" y="17" width="43" height="10" {...common} />
          <rect x="17" y="30" width="43" height="10" {...common} />
          <path className={styles.line} d="M21 8h22M21 21h29M21 34h18" />
        </>
      )}

      {layout === "TIMELINE" && (
        <>
          <path className={styles.timelineLine} d="M14 4v36" />
          <circle className={styles.timelineDot} cx="14" cy="9" r="3" />
          <circle className={styles.timelineDot} cx="14" cy="22" r="3" />
          <circle className={styles.timelineDot} cx="14" cy="35" r="3" />
          <rect x="23" y="4" width="37" height="10" {...common} />
          <rect x="23" y="17" width="30" height="10" {...common} />
          <rect x="23" y="30" width="37" height="10" {...common} />
          <path className={styles.line} d="M27 8h24M27 21h18M27 34h24" />
        </>
      )}

      {layout === "TABLE" && (
        <>
          <rect x="4" y="4" width="56" height="36" rx="3" className={styles.tableFrame} />
          <path className={styles.tableGrid} d="M4 13h56M4 22h56M4 31h56M20 4v36M44 4v36" />
          <rect className={styles.accent} x="7" y="7" width="10" height="3" rx="1.5" />
          <rect className={styles.accent} x="23" y="7" width="13" height="3" rx="1.5" />
          <rect className={styles.accent} x="47" y="7" width="9" height="3" rx="1.5" />
        </>
      )}
    </svg>
  );
}

export function LayoutPicker({ value, onChange }: {
  value: PadLayoutKind;
  onChange: (value: PadLayoutKind) => void;
}) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const optionRefs = useRef(new Map<PadLayoutKind, HTMLButtonElement>());
  const listboxId = useId();
  const selected = LAYOUT_OPTIONS.find((option) => option.value === value) ?? LAYOUT_OPTIONS[0];

  useEffect(() => {
    if (!open) return;
    function closeOnOutsideClick(event: MouseEvent) {
      if (rootRef.current && !rootRef.current.contains(event.target as Node)) setOpen(false);
    }
    // Modal도 document에서 Escape를 받아 패널 전체를 닫습니다. 레이아웃 메뉴가 열린 동안은
    // 캡처 단계에서 먼저 소비해 첫 Escape는 드롭다운만 닫고, 두 번째 Escape가 설정을 닫게 합니다.
    function closeOnEscape(event: globalThis.KeyboardEvent) {
      if (event.key !== "Escape") return;
      event.preventDefault();
      event.stopPropagation();
      setOpen(false);
      requestAnimationFrame(() => triggerRef.current?.focus());
    }
    document.addEventListener("mousedown", closeOnOutsideClick);
    document.addEventListener("keydown", closeOnEscape, true);
    return () => {
      document.removeEventListener("mousedown", closeOnOutsideClick);
      document.removeEventListener("keydown", closeOnEscape, true);
    };
  }, [open]);

  function openMenu(focusValue = value) {
    setOpen(true);
    requestAnimationFrame(() => optionRefs.current.get(focusValue)?.focus());
  }

  function select(next: PadLayoutKind) {
    onChange(next);
    setOpen(false);
    requestAnimationFrame(() => triggerRef.current?.focus());
  }

  function moveOptionFocus(event: KeyboardEvent<HTMLButtonElement>, index: number) {
    let nextIndex = index;
    if (event.key === "ArrowDown" || event.key === "ArrowRight") nextIndex = (index + 1) % LAYOUT_OPTIONS.length;
    else if (event.key === "ArrowUp" || event.key === "ArrowLeft") nextIndex = (index - 1 + LAYOUT_OPTIONS.length) % LAYOUT_OPTIONS.length;
    else if (event.key === "Home") nextIndex = 0;
    else if (event.key === "End") nextIndex = LAYOUT_OPTIONS.length - 1;
    else if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      setOpen(false);
      triggerRef.current?.focus();
      return;
    } else return;

    event.preventDefault();
    optionRefs.current.get(LAYOUT_OPTIONS[nextIndex].value)?.focus();
  }

  return (
    <div className={styles.root} ref={rootRef}>
      <button
        ref={triggerRef}
        type="button"
        className={styles.trigger}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={open ? listboxId : undefined}
        onClick={() => open ? setOpen(false) : openMenu()}
        onKeyDown={(event) => {
          if (!open && (event.key === "ArrowDown" || event.key === "ArrowUp")) {
            event.preventDefault();
            openMenu();
          }
        }}
      >
        <span className={styles.triggerPreview}><LayoutGlyph layout={selected.value} /></span>
        <span className={styles.copy}><b>{selected.label}</b><small>{selected.description}</small></span>
        <ChevronDown className={open ? styles.chevronOpen : ""} size={17} aria-hidden="true" />
      </button>

      {open && (
        <div className={styles.menu} id={listboxId} role="listbox" aria-label="패드 레이아웃">
          <div className={styles.menuHeading}>
            <b>레이아웃 선택</b>
            <small>게시물 배치를 미리 보고 선택하세요.</small>
          </div>
          <div className={styles.optionGrid}>
            {LAYOUT_OPTIONS.map((option, index) => (
              <button
                key={option.value}
                ref={(node) => {
                  if (node) optionRefs.current.set(option.value, node);
                  else optionRefs.current.delete(option.value);
                }}
                type="button"
                role="option"
                aria-selected={option.value === value}
                className={`${styles.option} ${option.value === value ? styles.optionActive : ""}`}
                onClick={() => select(option.value)}
                onKeyDown={(event) => moveOptionFocus(event, index)}
              >
                <span className={styles.optionPreview}><LayoutGlyph layout={option.value} /></span>
                <span className={styles.copy}><b>{option.label}</b><small>{option.description}</small></span>
                {option.value === value && <Check className={styles.check} size={15} aria-hidden="true" />}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
