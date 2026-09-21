"use client";

import { useState } from "react";
import { createPortal } from "react-dom";
import { useRouter } from "next/navigation";
import { ClockIcon, GlobeIcon, LockIcon, PlayIcon, SessionIcon } from "@/components/ui/icons";
import { InlineNotice } from "@/components/ui/feedback";
import { Modal } from "@/components/ui/modal";

export function QuizSessionDialog({ quizId, quizTitle, requiresLogin, publishedHere, onClose }: {
  quizId: string;
  quizTitle: string;
  requiresLogin: boolean;
  publishedHere: boolean;
  onClose: () => void;
}) {
  const router = useRouter();
  const [mode, setMode] = useState<"LIVE" | "ASYNC">("LIVE");
  const [openAt, setOpenAt] = useState("");
  const [dueAt, setDueAt] = useState("");
  const [allowLateSubmission, setAllowLateSubmission] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function createSession(event: React.FormEvent) {
    event.preventDefault();
    setSubmitting(true);
    setError(null);
    const body: Record<string, unknown> = { quizId, mode };
    if (mode === "ASYNC") {
      if (openAt) body.openAt = new Date(openAt).toISOString();
      if (dueAt) body.dueAt = new Date(dueAt).toISOString();
      body.allowLateSubmission = allowLateSubmission;
    }
    try {
      const response = await fetch("/api/quiz/sessions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        setError(data.error ?? "세션을 만들지 못했습니다.");
        return;
      }
      router.push(mode === "LIVE" ? `/quiz/host/${data.session.id}` : `/quiz/activities/${data.session.id}`);
    } catch {
      setError("네트워크 연결을 확인한 뒤 다시 시도해 주세요.");
    } finally {
      setSubmitting(false);
    }
  }

  return createPortal(
    <Modal open onClose={onClose} title={quizTitle} description="진행 방식을 선택해 새 세션을 엽니다." className="modal-md">
      <form onSubmit={createSession} className="p-6 sm:p-8">
        <div className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-[11px] font-black ${requiresLogin ? "bg-brand-soft text-brand-soft-fg" : "bg-info-soft text-info-soft-fg"}`}>{requiresLogin ? <LockIcon className="h-3.5 w-3.5" /> : <GlobeIcon className="h-3.5 w-3.5" />}{requiresLogin ? "학생 로그인 필요" : "닉네임으로 바로 참여"}</div>

        {publishedHere ? <div className="mt-5"><InlineNotice tone="success">퀴즈를 발행했습니다. 이제 세션을 열 수 있어요.</InlineNotice></div> : null}

        <fieldset className="mt-7"><legend className="text-sm font-black text-content">진행 방식</legend><div className="mt-3 grid gap-3 sm:grid-cols-2">
          <label className={`cursor-pointer rounded-2xl border p-5 transition ${mode === "LIVE" ? "border-accent-soft-fg bg-accent-soft ring-1 ring-accent-soft-fg" : "border-line"}`}><input type="radio" checked={mode === "LIVE"} onChange={() => setMode("LIVE")} className="sr-only" /><SessionIcon className="h-5 w-5 text-accent-soft-fg" /><span className="mt-3 block text-sm font-black text-content">라이브</span><span className="mt-1 block text-xs leading-5 text-content-muted">교사가 문항을 함께 진행합니다.</span></label>
          <label className={`cursor-pointer rounded-2xl border p-5 transition ${mode === "ASYNC" ? "border-info-soft-fg bg-info-soft ring-1 ring-info-soft-fg" : "border-line"}`}><input type="radio" checked={mode === "ASYNC"} onChange={() => setMode("ASYNC")} className="sr-only" /><ClockIcon className="h-5 w-5 text-info-soft-fg" /><span className="mt-3 block text-sm font-black text-content">자율 풀이</span><span className="mt-1 block text-xs leading-5 text-content-muted">각자 원하는 속도로 풉니다.</span></label>
        </div></fieldset>

        {mode === "ASYNC" ? <div className="mt-5 rounded-2xl bg-surface-muted p-4"><div className="grid gap-4 sm:grid-cols-2"><label className="text-xs font-black text-content-muted">공개 시각 <span className="font-medium text-content-subtle">(선택)</span><input type="datetime-local" value={openAt} onChange={(event) => setOpenAt(event.target.value)} className="mt-2 h-11 w-full rounded-xl border border-line bg-surface px-3 text-xs outline-none focus:border-brand-500" /></label><label className="text-xs font-black text-content-muted">마감 시각 <span className="font-medium text-content-subtle">(선택)</span><input type="datetime-local" value={dueAt} onChange={(event) => setDueAt(event.target.value)} className="mt-2 h-11 w-full rounded-xl border border-line bg-surface px-3 text-xs outline-none focus:border-brand-500" /></label></div><label className="mt-4 flex items-center gap-2 text-xs font-bold text-content-muted"><input type="checkbox" checked={allowLateSubmission} onChange={(event) => setAllowLateSubmission(event.target.checked)} className="h-4 w-4 rounded border-line-strong accent-brand-700" />마감 이후에도 제출 허용</label></div> : null}
        {error ? <div className="mt-5"><InlineNotice tone="error">{error}</InlineNotice></div> : null}
        <div className="mt-7 flex justify-end gap-2"><button type="button" onClick={onClose} className="rounded-xl border border-line px-5 py-3 text-sm font-black text-content-muted">취소</button><button type="submit" disabled={submitting} className="inline-flex min-h-12 items-center gap-2 rounded-xl bg-brand-strong px-6 py-3 text-sm font-black text-on-brand disabled:opacity-50"><PlayIcon className="h-4 w-4" />{submitting ? "여는 중..." : "세션 열기"}</button></div>
      </form>
    </Modal>,
    document.body,
  );
}
