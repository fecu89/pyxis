"use client";

import { AlertTriangle, Check, History } from "lucide-react";
import styles from "@/components/pad/composer/draft-status.module.css";

export function DraftRecovery({
  savedAt,
  onRestore,
  onDiscard,
}: {
  savedAt: string;
  onRestore: () => void;
  onDiscard: () => void;
}) {
  return (
    <aside className={styles.recovery} role="status">
      <History size={18} aria-hidden />
      <span className={styles.copy}>
        <strong>저장되지 않은 초안이 있습니다.</strong>
        <span>
          {new Intl.DateTimeFormat("ko", {
            dateStyle: "short",
            timeStyle: "short",
            timeZone: "Asia/Seoul",
          }).format(new Date(savedAt))}
          에 이 브라우저에 저장됨
        </span>
      </span>
      <span className={styles.actions}>
        <button type="button" onClick={onRestore}>복구</button>
        <button type="button" onClick={onDiscard}>삭제</button>
      </span>
    </aside>
  );
}

export function DraftSaveState({
  lastSavedAt,
  storageError,
}: {
  lastSavedAt: string | null;
  storageError: boolean;
}) {
  if (storageError) {
    return (
      <span className={styles.error} role="status">
        <AlertTriangle size={13} />
        이 브라우저에는 초안을 저장할 수 없습니다.
      </span>
    );
  }
  if (!lastSavedAt) return null;
  return (
    <span className={styles.saved} role="status">
      <Check size={13} />
      이 브라우저에 자동 저장됨
    </span>
  );
}
