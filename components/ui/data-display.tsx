import type { ReactNode } from "react";

const TONE = {
  success: "bg-success-soft text-success-soft-fg ring-success-soft-fg/10 dark:ring-success-soft-fg/20",
  warning: "bg-warning-soft text-warning-soft-fg ring-warning-soft-fg/10 dark:ring-warning-soft-fg/20",
  info: "bg-info-soft text-info-soft-fg ring-info-soft-fg/10 dark:ring-info-soft-fg/20",
  progress: "bg-progress-soft text-progress-soft-fg ring-progress-soft-fg/10 dark:ring-progress-soft-fg/20",
  neutral: "bg-neutral-soft text-neutral-soft-fg ring-neutral-soft-fg/10 dark:ring-neutral-soft-fg/20",
  danger: "bg-danger-soft text-danger-soft-fg ring-danger-soft-fg/10 dark:ring-danger-soft-fg/20",
  accent: "bg-accent-soft text-accent-soft-fg ring-accent-soft-fg/10 dark:ring-accent-soft-fg/20",
} as const;

const badgeStyles: Record<string, string> = {
  PUBLISHED: TONE.success,
  PENDING: TONE.warning,
  REJECTED: TONE.danger,
  DRAFT: TONE.warning,
  LOBBY: TONE.info,
  IN_PROGRESS: TONE.progress,
  FINISHED: TONE.neutral,
  CANCELLED: TONE.danger,
  ACTIVE: TONE.success,
  SUSPENDED: TONE.danger,
  JOINED: TONE.info,
  COMPLETED: TONE.success,
  LEFT: TONE.neutral,
  KICKED: TONE.danger,
  LIVE: TONE.accent,
  ASYNC: TONE.info,
  FORM: TONE.progress,
};

const badgeLabels: Record<string, string> = {
  PUBLISHED: "발행됨", PENDING: "승인 대기", REJECTED: "반려됨", DRAFT: "초안", LOBBY: "대기 중", IN_PROGRESS: "진행 중", FINISHED: "종료됨", CANCELLED: "취소됨",
  ACTIVE: "사용 중", SUSPENDED: "일시 정지", JOINED: "참여", COMPLETED: "완료", LEFT: "나감", KICKED: "내보냄", LIVE: "라이브", ASYNC: "자율 풀이",
  FORM: "설문",
};

export function StatusBadge({ status, label }: { status: string; label?: string }) {
  return <span className={`inline-flex items-center rounded-full px-2.5 py-1 text-[11px] font-black ring-1 ring-inset ${badgeStyles[status] ?? "bg-surface-muted text-content-muted ring-line"}`}>{label ?? badgeLabels[status] ?? status}</span>;
}

export function StatCard({ label, value, hint, icon, tone = "brand", compactMobile = false }: {
  label: string;
  value: ReactNode;
  hint?: string;
  icon: ReactNode;
  tone?: "brand" | "warning" | "accent" | "info" | "success" | "danger";
  /** 좁은 화면의 3열 요약처럼 카드가 작아야 하는 곳에서만 모바일 밀도를 낮춥니다. */
  compactMobile?: boolean;
}) {
  const tones = {
    brand: "bg-brand-strong text-on-brand",
    warning: "bg-warning-soft text-warning-soft-fg",
    accent: "bg-accent-soft text-accent-soft-fg",
    info: "bg-info-soft text-info-soft-fg",
    success: "bg-success-soft text-success-soft-fg",
    danger: "bg-danger-soft text-danger-soft-fg",
  };
  return (
    <div className={`h-full rounded-[var(--radius-lg)] border border-line bg-surface shadow-sm ${compactMobile ? "p-2.5 sm:p-5" : "p-5"}`}>
      <div className={compactMobile
        ? "flex h-full min-h-20 flex-col-reverse items-center justify-center gap-1.5 text-center sm:min-h-0 sm:flex-row sm:items-start sm:justify-between sm:gap-3 sm:text-left"
        : "flex items-start justify-between gap-3"}
      >
        <div>
          <p className={compactMobile ? "text-[10px] font-bold text-content-muted sm:text-xs" : "text-xs font-bold text-content-muted"}>{label}</p>
          {value !== null ? <p className={compactMobile ? "mt-0.5 text-xl font-black tracking-[-0.05em] text-content sm:mt-2 sm:text-3xl" : "mt-2 text-3xl font-black tracking-[-0.05em] text-content"}>{value}</p> : null}
          {hint && <p className="mt-2 text-xs text-content-muted">{hint}</p>}
        </div>
        <div className={`grid shrink-0 place-items-center rounded-lg sm:rounded-xl ${compactMobile ? "h-7 w-7 sm:h-10 sm:w-10" : "h-10 w-10"} ${tones[tone]}`}>{icon}</div>
      </div>
    </div>
  );
}
