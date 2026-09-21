"use client";

import Link from "next/link";
import { Ellipsis } from "lucide-react";
import { useEffect, useId, useLayoutEffect, useRef, type CSSProperties, type ReactNode, type RefObject } from "react";
import { createPortal } from "react-dom";
import styles from "@/components/ui/content-card.module.css";

export type ContentCardMenuProps = {
  title: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  children: ReactNode;
  triggerContent?: ReactNode;
  triggerLabel?: string;
  triggerClassName?: string;
  triggerRef?: RefObject<HTMLButtonElement | null>;
  disabled?: boolean;
  panelWidth?: number;
  panelMaxHeight?: number;
  keyboardNavigation?: boolean;
};

export function ContentCardMenu({ title, open, onOpenChange, children, triggerContent, triggerLabel, triggerClassName, triggerRef, disabled = false, panelWidth = 226, panelMaxHeight, keyboardNavigation = false }: ContentCardMenuProps) {
  const id = useId();
  const trigger = useRef<HTMLButtonElement>(null);
  const panel = useRef<HTMLDivElement>(null);
  const focusOnOpen = useRef(false);
  const changeRef = useRef(onOpenChange);
  useEffect(() => { changeRef.current = onOpenChange; }, [onOpenChange]);

  useLayoutEffect(() => {
    if (!open) return;
    function position() {
      if (!trigger.current || !panel.current) return;
      const rect = trigger.current.getBoundingClientRect();
      const width = Math.min(panelWidth, window.innerWidth - 32);
      const height = Math.min(panel.current.scrollHeight, panelMaxHeight ?? Infinity, window.innerHeight - 32);
      const below = rect.bottom + 6;
      const top = below + height <= window.innerHeight - 16 ? below : Math.max(16, rect.top - height - 6);
      panel.current.style.setProperty("--menu-left", `${Math.max(16, Math.min(rect.right - width, window.innerWidth - width - 16))}px`);
      panel.current.style.setProperty("--menu-top", `${top}px`);
    }
    function dismiss(event: PointerEvent | FocusEvent) {
      const target = event.target as Node;
      if (!trigger.current?.contains(target) && !panel.current?.contains(target)) changeRef.current(false);
    }
    function keydown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        event.preventDefault();
        changeRef.current(false);
        trigger.current?.focus();
      }
    }
    position();
    const selected = keyboardNavigation ? panel.current?.querySelector<HTMLElement>('[data-selected="true"]') : null;
    selected?.scrollIntoView({ block: "nearest" });
    if (focusOnOpen.current) {
      (selected ?? panel.current?.querySelector<HTMLElement>("button:not(:disabled), a[href], select:not(:disabled), input:not(:disabled)"))?.focus();
      focusOnOpen.current = false;
    }
    document.addEventListener("pointerdown", dismiss);
    document.addEventListener("focusin", dismiss);
    document.addEventListener("keydown", keydown);
    window.addEventListener("resize", position);
    window.addEventListener("scroll", position, true);
    const observer = new ResizeObserver(position);
    if (panel.current) observer.observe(panel.current);
    return () => {
      document.removeEventListener("pointerdown", dismiss);
      document.removeEventListener("focusin", dismiss);
      document.removeEventListener("keydown", keydown);
      window.removeEventListener("resize", position);
      window.removeEventListener("scroll", position, true);
      observer.disconnect();
    };
  }, [open, panelWidth, panelMaxHeight, keyboardNavigation]);

  return (
    <>
      <button
        ref={(node) => { trigger.current = node; if (triggerRef) triggerRef.current = node; }}
        type="button"
        className={triggerClassName ?? styles.moreTrigger}
        aria-label={triggerLabel ?? `${title} 옵션`}
        aria-expanded={open}
        aria-controls={id}
        disabled={disabled}
        onClick={(event) => { focusOnOpen.current = event.detail === 0; onOpenChange(!open); }}
        onKeyDown={(event) => {
          if (event.key === "ArrowDown") { event.preventDefault(); focusOnOpen.current = true; onOpenChange(true); }
        }}
      >{triggerContent ?? <Ellipsis size={18} aria-hidden />}</button>
      {open && typeof document !== "undefined" ? createPortal(
        <div ref={panel} id={id} role="group" aria-label={`${title} 옵션`} className={styles.menuPanel}
          style={{ "--menu-width": `${panelWidth}px`, "--menu-max-height": panelMaxHeight ? `${panelMaxHeight}px` : undefined } as CSSProperties}
          onKeyDown={(event) => {
            if (!keyboardNavigation || !["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) return;
            const items = Array.from(event.currentTarget.querySelectorAll<HTMLElement>("button:not(:disabled), a[href]"));
            if (!items.length) return;
            event.preventDefault();
            const current = items.indexOf(document.activeElement as HTMLElement);
            const next = event.key === "Home" ? 0 : event.key === "End" ? items.length - 1
              : event.key === "ArrowDown" ? (current + 1) % items.length : (current - 1 + items.length) % items.length;
            items[next].focus();
          }}
          onClick={(event) => { if ((event.target as Element).closest("a[href]")) onOpenChange(false); }}>
          {children}
        </div>, document.body,
      ) : null}
    </>
  );
}

export function ContentCardMenuItem({ icon, children, href, onClick, disabled = false, danger = false, pressed, selected, description, trailingIcon, expanded, controls }: {
  icon: ReactNode;
  children: ReactNode;
  href?: string;
  onClick?: () => void;
  disabled?: boolean;
  danger?: boolean;
  pressed?: boolean;
  selected?: boolean;
  description?: string;
  trailingIcon?: ReactNode;
  expanded?: boolean;
  controls?: string;
}) {
  const content = <>{icon}<span className={styles.menuItemText}>{children}{description && <small>{description}</small>}</span>{trailingIcon}</>;
  return href
    ? <Link href={href} prefetch={false} className={styles.menuItem} onClick={onClick}>{content}</Link>
    : <button type="button" className={styles.menuItem} data-danger={danger || undefined} data-has-trailing={Boolean(trailingIcon) || undefined} data-has-description={Boolean(description) || undefined} data-selected={selected || undefined} disabled={disabled} aria-pressed={selected ?? pressed} aria-expanded={expanded} aria-controls={controls} onClick={onClick}>{content}</button>;
}

export function ContentCardMenuSection({ label, children }: { label: string; children: ReactNode }) {
  return <div className={styles.menuSection}><span>{label}</span>{children}</div>;
}
