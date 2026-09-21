"use client";

import dynamic from "next/dynamic";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { AlertIcon, PlayIcon, XIcon } from "@/components/ui/icons";
import cardStyles from "@/components/ui/content-card.module.css";

// 날짜 입력·진행 방식·세션 생성 상태는 카드마다 만들 필요가 없습니다. 실제로 버튼을 누른
// 카드 한 장만 모달 청크와 그 상태 훅을 마운트합니다.
const loadQuizSessionDialog = () => import("@/components/quiz/quiz-session-dialog");
const QuizSessionDialog = dynamic(() => loadQuizSessionDialog().then((mod) => mod.QuizSessionDialog), { ssr: false });

export function QuizSessionLauncher({ quizId, quizTitle, requiresLogin, isPublished, compact = false }: {
  quizId: string;
  quizTitle: string;
  requiresLogin: boolean;
  isPublished: boolean;
  compact?: boolean;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [publishedHere, setPublishedHere] = useState(false);
  const [publishing, setPublishing] = useState(false);
  const [publishError, setPublishError] = useState<string | null>(null);
  const published = isPublished || publishedHere;

  // 초안이라고 세션 버튼을 감추지 않고, 눌렀을 때 발행까지 이어서 처리합니다.
  async function startLaunch() {
    if (published) { setOpen(true); return; }
    setPublishing(true);
    setPublishError(null);
    try {
      const response = await fetch(`/api/quiz/quizzes/${quizId}/publish`, { method: "POST" });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        setPublishError(typeof data.error === "string" ? data.error : "퀴즈를 발행하지 못했습니다.");
        return;
      }
      setPublishedHere(true);
      setOpen(true);
      router.refresh();
    } catch {
      setPublishError("네트워크 연결을 확인한 뒤 다시 시도해 주세요.");
    } finally {
      setPublishing(false);
    }
  }

  const triggerLabel = publishing ? "발행 중..." : published ? "세션 열기" : "발행하고 세션 열기";

  return (
    <span className="relative inline-flex">
      <button type="button" onPointerEnter={() => void loadQuizSessionDialog()} onFocus={() => void loadQuizSessionDialog()} onClick={() => void startLaunch()} disabled={publishing} className={compact ? cardStyles.actionButton : "inline-flex min-h-11 items-center gap-2 rounded-xl bg-brand-strong px-5 py-3 text-sm font-black text-on-brand disabled:opacity-50"}>
        <PlayIcon className="h-4 w-4" />{triggerLabel}
      </button>

      {publishError ? (
        <span role="alert" className="absolute bottom-full right-0 z-40 mb-2 w-64 rounded-2xl border border-warning-soft-fg/40 bg-surface p-3 text-left shadow-[0_16px_40px_rgba(15,23,42,.18)]">
          <span className="flex items-start gap-2">
            <AlertIcon className="mt-0.5 h-4 w-4 shrink-0 text-warning-soft-fg" />
            <span className="min-w-0 text-left text-[11px] font-bold leading-5 text-content">{publishError}</span>
            <button type="button" onClick={() => setPublishError(null)} className="-mr-1 -mt-1 grid h-6 w-6 shrink-0 place-items-center rounded-lg text-content-subtle hover:bg-surface-muted" aria-label="닫기"><XIcon className="h-3.5 w-3.5" /></button>
          </span>
          <Link href={`/quiz/${quizId}/edit`} className="mt-2 block text-[11px] font-black text-brand hover:text-brand-900 dark:hover:text-brand-200">편집기에서 마저 채우기 →</Link>
        </span>
      ) : null}

      {open ? <QuizSessionDialog quizId={quizId} quizTitle={quizTitle} requiresLogin={requiresLogin} publishedHere={publishedHere} onClose={() => setOpen(false)} /> : null}
    </span>
  );
}
