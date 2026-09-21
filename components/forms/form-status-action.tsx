"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { CircleStop, LoaderCircle, RotateCcw } from "lucide-react";
import { useDialog } from "@/components/ui/app-dialog";
import { InlineNotice } from "@/components/ui/feedback";
import { notifySidebarDataChanged } from "@/lib/sidebar-events";

export function FormStatusAction({ formId, status, compact = false }: {
  formId: string;
  status: "OPEN" | "CLOSED";
  compact?: boolean;
}) {
  const router = useRouter();
  const dialog = useDialog();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function changeStatus() {
    if (status === "OPEN") {
      const confirmed = await dialog.confirm({
        title: "설문 응답을 마감할까요?",
        description: "응답 링크는 유지되지만 새 응답은 받지 않습니다. 필요하면 나중에 다시 열 수 있습니다.",
        danger: true,
        confirmLabel: "응답 마감",
      });
      if (!confirmed) return;
    }

    setPending(true);
    setError(null);
    try {
      const response = await fetch(`/api/forms/${formId}/${status === "OPEN" ? "close" : "publish"}`, { method: "POST" });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        setError(typeof data.error === "string" ? data.error : status === "OPEN" ? "설문을 마감하지 못했습니다." : "설문을 다시 열지 못했습니다.");
        return;
      }
      notifySidebarDataChanged("form");
      router.refresh();
    } catch {
      setError("네트워크 연결을 확인한 뒤 다시 시도해 주세요.");
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="contents">
      <button
        type="button"
        onClick={() => void changeStatus()}
        disabled={pending}
        aria-label={pending ? "설문 상태 변경 중" : status === "OPEN" ? "설문 응답 마감" : "다시 응답 받기"}
        title={pending ? "설문 상태 변경 중" : status === "OPEN" ? "설문 응답 마감" : "다시 응답 받기"}
        className={compact
          ? `inline-flex h-full min-w-0 flex-1 items-center justify-center gap-2 rounded-lg border border-line px-2 text-xs font-black shadow-sm transition disabled:opacity-45 sm:flex-none sm:px-4 ${status === "OPEN" ? "bg-danger-soft text-danger-soft-fg hover:brightness-95" : "bg-surface text-content-muted hover:border-brand-300 hover:bg-surface-hover hover:text-brand"}`
          : status === "OPEN" ? "button danger" : "button soft"}
      >
        {pending
          ? <LoaderCircle className="h-4 w-4 animate-spin" aria-hidden />
          : status === "OPEN"
            ? <CircleStop className="h-4 w-4" aria-hidden />
            : <RotateCcw className="h-4 w-4" aria-hidden />}
        <span className={compact ? "hidden sm:inline" : undefined}>{pending ? "처리 중..." : status === "OPEN" ? "응답 마감" : "다시 응답 받기"}</span>
      </button>
      {error && (compact
        ? <p role="alert" className="fixed bottom-5 left-1/2 z-50 -translate-x-1/2 rounded-full bg-danger px-4 py-2 text-xs font-black text-white shadow-lg">{error}</p>
        : <div className="basis-full"><InlineNotice tone="error">{error}</InlineNotice></div>)}
    </div>
  );
}
