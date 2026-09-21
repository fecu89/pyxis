"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowRightIcon, GlobeIcon, LockIcon, QuizIcon } from "@/components/ui/icons";
import { StatusBadge } from "@/components/ui/data-display";
import { InlineNotice } from "@/components/ui/feedback";

export function JoinSessionCard({ pin, quizTitle, mode, requiresLogin, initialNickname, canJoin, resume, publicAccess = false, autoJoin = false }: {
  pin: string;
  quizTitle: string;
  mode: "LIVE" | "ASYNC";
  requiresLogin: boolean;
  initialNickname: string;
  canJoin: boolean;
  resume: boolean;
  publicAccess?: boolean;
  autoJoin?: boolean;
}) {
  const router = useRouter();
  const [nickname, setNickname] = useState(initialNickname);
  const [submitting, setSubmitting] = useState(autoJoin && canJoin);
  const [error, setError] = useState<string | null>(null);
  const autoJoinStarted = useRef(false);

  useEffect(() => {
    if (!autoJoin || publicAccess || !canJoin || autoJoinStarted.current) return;
    autoJoinStarted.current = true;

    const controller = new AbortController();
    void fetch("/api/quiz/sessions/join", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ pin }),
      signal: controller.signal,
    }).then(async (response) => ({ response, data: await response.json() })).then(({ response, data }) => {
      if (controller.signal.aborted) return;
      if (!response.ok) {
        setSubmitting(false);
        setError(data.error ?? "세션에 참여하지 못했습니다.");
        return;
      }
      router.replace(`/p/${data.sessionId}`);
    }).catch(() => {
      if (controller.signal.aborted) return;
      setSubmitting(false);
      setError("세션에 참여하지 못했습니다.");
    });

    return () => {
      controller.abort();
      // React 개발 모드의 effect 재실행에서도 두 번째 입장을 정상 시작할 수 있어야 합니다.
      autoJoinStarted.current = false;
    };
  }, [autoJoin, canJoin, pin, publicAccess, router]);

  async function join(event: React.FormEvent) {
    event.preventDefault();
    if (!canJoin) return;
    setSubmitting(true);
    setError(null);
    const response = await fetch(publicAccess ? "/api/public/sessions/join" : "/api/quiz/sessions/join", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ pin, ...(!requiresLogin ? { nickname } : {}) }),
    });
    const data = await response.json();
    setSubmitting(false);
    if (!response.ok) {
      setError(data.error ?? "세션에 참여하지 못했습니다.");
      return;
    }
    router.replace(`/p/${data.sessionId}`);
  }

  return (
    <section className="w-full max-w-lg rounded-[34px] border border-line bg-surface p-6 shadow-[0_28px_80px_rgba(24,30,38,.13)] sm:p-9">
      <div className="flex items-start justify-between gap-4"><div className="grid h-12 w-12 place-items-center rounded-2xl bg-brand-soft text-brand-soft-fg"><QuizIcon className="h-6 w-6" /></div><StatusBadge status={mode} /></div>
      <p className="mt-7 text-xs font-black uppercase tracking-[0.18em] text-brand">Ready to join · {pin}</p>
      <h1 className="mt-3 text-3xl font-black tracking-[-0.045em] text-content">{quizTitle}</h1>
      <div className={`mt-4 flex items-start gap-3 rounded-2xl p-4 ${requiresLogin ? "bg-brand-soft/40 text-brand-soft-fg" : "bg-info-50 text-info-900 dark:bg-info-400/10 dark:text-info-200"}`}>{requiresLogin ? <LockIcon className="mt-0.5 h-5 w-5 shrink-0" /> : <GlobeIcon className="mt-0.5 h-5 w-5 shrink-0" />}<div><p className="text-sm font-black">{requiresLogin ? "학생 계정으로 기록됩니다" : "로그인 없이 참여합니다"}</p><p className="mt-1 text-xs leading-5 opacity-70">{requiresLogin ? "응시 결과를 내 기록에서 계속 확인할 수 있어요." : "입력한 닉네임은 이 세션 결과에만 표시돼요."}</p></div></div>
      <form onSubmit={join} className="mt-6">
        {!requiresLogin ? <label className="block text-sm font-black text-content-muted">세션 닉네임<input autoFocus={!resume} value={nickname} onChange={(event) => setNickname(event.target.value)} disabled={resume} required minLength={1} maxLength={40} placeholder="예: 푸른고래" className="mt-2 h-13 w-full rounded-2xl border border-line bg-surface-muted px-4 text-base font-bold outline-none transition placeholder:font-normal placeholder:text-content-subtle focus:border-info-500 focus:bg-surface disabled:text-content-muted" /></label> : null}
        {error ? <div className="mt-4"><InlineNotice tone="error">{error}</InlineNotice></div> : null}
        <button type="submit" disabled={submitting || !canJoin || (!requiresLogin && !nickname.trim())} className="mt-5 flex min-h-14 w-full items-center justify-center gap-2 rounded-2xl bg-brand-strong px-6 text-base font-black text-on-brand transition hover:-translate-y-0.5 disabled:opacity-40">{submitting ? "세션으로 이동 중..." : resume ? "이어서 참여하기" : "퀴즈 입장"}<ArrowRightIcon className="h-5 w-5" /></button>
      </form>
    </section>
  );
}
