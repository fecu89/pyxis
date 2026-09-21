"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { MoreHorizontal } from "lucide-react";
import styles from "@/components/pad/pad-more-menu.module.css";

export type PadMoreMenuItem = {
  key: string;
  label: string;
  icon: ReactNode;
  onClick: () => void;
  tone?: "default" | "danger";
};

// 자주 안 쓰는 보드 상단 아이콘들(활동·팔로우·보관함·내보내기)을 "더보기" 하나로
// 묶어, 모바일 상단바가 아이콘으로 가득 차는 문제를 줄입니다. NotificationBell과 같은
// 클릭 바깥 감지 패턴을 그대로 씁니다.
export function PadMoreMenu({
  items,
  className = "icon-button",
  rootClassName,
  ariaLabel = "더보기",
}: {
  items: PadMoreMenuItem[];
  className?: string;
  rootClassName?: string;
  ariaLabel?: string;
}) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function onClickOutside(event: MouseEvent) {
      if (rootRef.current && !rootRef.current.contains(event.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", onClickOutside);
    return () => document.removeEventListener("mousedown", onClickOutside);
  }, [open]);

  if (items.length === 0) return null;

  return (
    <div className={`${styles.root} ${rootClassName ?? ""}`.trim()} ref={rootRef}>
      <button type="button" className={className} aria-label={ariaLabel} aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen((value) => !value)}>
        <MoreHorizontal size={18} />
      </button>
      {open && (
        <div className={styles.panel} role="menu" aria-label={`${ariaLabel} 메뉴`}>
          {items.map((item) => (
            <button key={item.key} type="button" role="menuitem" className={styles.item} data-tone={item.tone ?? "default"} onClick={() => { setOpen(false); item.onClick(); }}>
              {item.icon}
              <span>{item.label}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
