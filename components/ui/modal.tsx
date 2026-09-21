"use client";

import { useEffect, useId, useRef, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { X } from "lucide-react";
import { cn } from "@/lib/cn";

const focusableSelector = "button:not([disabled]), a[href], input:not([disabled]), textarea:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex='-1'])";
const openModalStack: symbol[] = [];

export function Modal({ open, onClose, title, description, children, className, variant = "center", headerAction }: {
  open: boolean;
  onClose: () => void;
  title: string;
  description?: string;
  children: ReactNode;
  className?: string;
  headerAction?: ReactNode;
  // "side"는 오른쪽에서 슬라이드로 열리는 패널입니다. 설정처럼 뒤에 있는 보드가 어떻게
  // 바뀌는지 보면서 조정해야 하는 화면에 씁니다(가운데 모달은 게시물을 다 가려서 요청받음).
  variant?: "center" | "side" | "composer" | "bottom";
}) {
  const panelRef = useRef<HTMLElement>(null);
  const backdropRef = useRef<HTMLDivElement>(null);
  const previousFocusRef = useRef<HTMLElement | null>(null);
  const instanceRef = useRef(Symbol("modal"));
  const generatedId = useId();
  const titleId = `${generatedId}-title`;
  const descriptionId = `${generatedId}-description`;
  // onClose는 호출부에서 인라인 함수나 매번 새로 만들어지는 콜백으로 넘어오는 경우가 많아
  // (예: post-composer.tsx의 closeComposer는 매번 새 객체인 큐 상태에 의존) 참조가 렌더마다
  // 바뀝니다. 이 이펙트가 onClose를 의존성 배열에 두면 그때마다(예: 입력창에 한 글자 칠 때마다)
  // 다시 실행되어 포커스를 다시 훔쳐가므로("타이핑하면 자꾸 닫기 버튼으로 포커스 이동"), ref로
  // 최신 값만 참조하고 이펙트 자체는 open이 바뀔 때만 실행합니다.
  const onCloseRef = useRef(onClose);
  useEffect(() => { onCloseRef.current = onClose; });

  useEffect(() => {
    if (!open) return;
    const instance = instanceRef.current;
    openModalStack.push(instance);
    previousFocusRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const panel = panelRef.current;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const frame = requestAnimationFrame(() => {
      // React의 autoFocus prop은 마운트 시 곧바로 focus()만 호출할 뿐 실제 DOM에 autofocus
      // 속성을 남기지 않으므로 "[autofocus]" 셀렉터는 항상 매치되지 않았고, 그래서 이 콜백이
      // 매번 무조건 "첫 포커스 가능 요소"(대개 헤더의 닫기 버튼)로 되돌리고 있었습니다. 이미
      // 패널 안의 무언가에 포커스가 가 있으면(React autoFocus든 사용자 클릭이든) 건드리지 않고,
      // 아무 데도 포커스가 없을 때만 첫 요소로 기본 포커스를 줍니다.
      if (panel && document.activeElement instanceof Node && panel.contains(document.activeElement)) return;
      const first = panel?.querySelector<HTMLElement>(focusableSelector);
      (first ?? panel)?.focus();
    });
    const handleKeyDown = (event: KeyboardEvent) => {
      if (openModalStack.at(-1) !== instance) return;
      if (event.key === "Escape") {
        event.preventDefault();
        return onCloseRef.current();
      }
      if (event.key !== "Tab" || !panel) return;
      const items = Array.from(panel.querySelectorAll<HTMLElement>(focusableSelector));
      if (!items.length) {
        event.preventDefault();
        panel.focus();
        return;
      }
      const first = items[0];
      const last = items[items.length - 1];
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
    };
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      cancelAnimationFrame(frame);
      document.removeEventListener("keydown", handleKeyDown);
      const index = openModalStack.lastIndexOf(instance);
      if (index >= 0) openModalStack.splice(index, 1);
      document.body.style.overflow = previousOverflow;
      previousFocusRef.current?.focus();
    };
  }, [open]);

  useEffect(() => {
    if (!open || (variant !== "composer" && variant !== "bottom")) return;
    const backdrop = backdropRef.current;
    if (!backdrop) return;
    const viewport = window.visualViewport;
    const syncViewport = () => {
      const height = viewport?.height ?? window.innerHeight;
      const offsetTop = viewport?.offsetTop ?? 0;
      backdrop.style.top = `${offsetTop}px`;
      backdrop.style.height = `${height}px`;
      backdrop.style.bottom = "auto";
      backdrop.dataset.keyboard = String(Boolean(viewport && height < window.innerHeight - 120));
    };
    syncViewport();
    viewport?.addEventListener("resize", syncViewport);
    viewport?.addEventListener("scroll", syncViewport);
    window.addEventListener("resize", syncViewport);
    return () => {
      viewport?.removeEventListener("resize", syncViewport);
      viewport?.removeEventListener("scroll", syncViewport);
      window.removeEventListener("resize", syncViewport);
      backdrop.style.removeProperty("top");
      backdrop.style.removeProperty("height");
      backdrop.style.removeProperty("bottom");
      delete backdrop.dataset.keyboard;
    };
  }, [open, variant]);

  if (!open) return null;
  const sidePanel = variant === "side" || variant === "composer";
  const bottomPanel = variant === "bottom";
  const modal = (
    <div ref={backdropRef} className={cn("modal-backdrop", sidePanel && "modal-side", variant === "composer" && "modal-composer-backdrop", bottomPanel && "modal-bottom-backdrop")} role="presentation" onMouseDown={(event) => { if (event.currentTarget === event.target) onClose(); }}>
      <section ref={panelRef} tabIndex={-1} className={cn("modal-panel", sidePanel && "modal-panel-side", variant === "composer" && "modal-panel-composer", bottomPanel && "modal-panel-bottom", className)} role="dialog" aria-modal="true" aria-label={headerAction ? title : undefined} aria-labelledby={headerAction ? undefined : titleId} aria-describedby={!headerAction && description ? descriptionId : undefined}>
        <header className={cn("modal-header", headerAction && "modal-header-actions-only")}>
          {headerAction ? (
            <>
              <button type="button" className="icon-button" onClick={onClose} aria-label="창 닫기"><X size={19} /></button>
              {headerAction}
            </>
          ) : (
            <>
              <div><h2 id={titleId}>{title}</h2>{description && <p id={descriptionId}>{description}</p>}</div>
              <button type="button" className="icon-button" onClick={onClose} aria-label="닫기"><X size={18} /></button>
            </>
          )}
        </header>
        {children}
      </section>
    </div>
  );
  // transform뿐 아니라 filter/backdrop-filter가 있는 조상도 position: fixed의 기준 영역과
  // stacking context를 새로 만듭니다. 알림 벨처럼 sticky nav 안에서 연 중앙 모달이 62px짜리
  // 상단바에 갇히지 않도록, 종류와 관계없이 모든 모달을 최상위 body 레이어로 분리합니다.
  return typeof document !== "undefined" ? createPortal(modal, document.body) : modal;
}
