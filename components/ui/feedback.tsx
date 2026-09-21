import type { ReactNode } from "react";
import { AlertIcon, CheckIcon } from "@/components/ui/icons";

export function EmptyState({ icon, title, description, action }: { icon?: ReactNode; title: string; description: string; action?: ReactNode }) {
  return (
    <div className="rounded-[var(--radius-lg)] border border-dashed border-line-strong bg-surface/60 px-6 py-14 text-center">
      {icon && <div className="mx-auto mb-4 grid h-12 w-12 place-items-center rounded-2xl bg-brand-soft text-brand-soft-fg">{icon}</div>}
      <h2 className="text-lg font-black tracking-tight text-content">{title}</h2>
      <p className="mx-auto mt-2 max-w-md text-sm leading-6 text-content-muted">{description}</p>
      {action && <div className="mt-6">{action}</div>}
    </div>
  );
}

export function InlineNotice({ children, tone = "info" }: { children: ReactNode; tone?: "info" | "success" | "error" | "warning" }) {
  const tones = {
    info: "border-info-soft-fg/25 bg-info-soft text-info-soft-fg",
    success: "border-success-soft-fg/25 bg-success-soft text-success-soft-fg",
    error: "border-danger-soft-fg/25 bg-danger-soft text-danger-soft-fg",
    warning: "border-warning-soft-fg/25 bg-warning-soft text-warning-soft-fg",
  };
  return <div role={tone === "error" ? "alert" : undefined} className={`flex items-start gap-2.5 rounded-2xl border px-4 py-3 text-sm leading-6 ${tones[tone]}`}>{tone === "success" ? <CheckIcon className="mt-0.5 h-4 w-4 shrink-0" /> : <AlertIcon className="mt-0.5 h-4 w-4 shrink-0" />}<div>{children}</div></div>;
}

export function ProgressBar({ value, max, label }: { value: number; max: number; label?: string }) {
  const percentage = max > 0 ? Math.min(100, Math.max(0, (value / max) * 100)) : 0;
  return <div>{label && <div className="mb-2 flex justify-between text-xs font-bold text-content-muted"><span>{label}</span><span>{value}/{max}</span></div>}<div className="h-2 overflow-hidden rounded-full bg-surface-muted"><div className="h-full rounded-full bg-brand transition-all duration-500" style={{ width: `${percentage}%` }} /></div></div>;
}

export function LoadingCard({ label = "불러오는 중..." }: { label?: string }) {
  return <div className="grid min-h-64 place-items-center rounded-[var(--radius-lg)] border border-line bg-surface"><div className="text-center"><span className="mx-auto block h-8 w-8 animate-spin rounded-full border-[3px] border-line border-t-brand" /><p className="mt-4 text-sm font-bold text-content-muted">{label}</p></div></div>;
}
