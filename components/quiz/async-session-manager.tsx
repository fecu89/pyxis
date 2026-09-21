"use client";

import { useRouter } from "next/navigation";
import { useDialog } from "@/components/ui/app-dialog";
import { useState } from "react";
import { ClockIcon, SessionIcon, UsersIcon } from "@/components/ui/icons";
import { CopyButton } from "@/components/ui/copy-button";
import { JoinQrCode } from "@/components/quiz/join-qr-code";
import { StatusBadge } from "@/components/ui/data-display";
import { InlineNotice } from "@/components/ui/feedback";
import { formatDateTime } from "@/lib/format";

type Participant = { id: string; nickname: string; score: number; status: string; currentQuestionIndex: number; joinedAt: string };
type SessionData = { id: string; status: string; pinCode: string | null; openAt: string | null; dueAt: string | null; allowLateSubmission: boolean; requiresLogin: boolean; totalQuestions: number; participantCount: number; participants: Participant[] };

export function AsyncSessionManager({ initial }: { initial: SessionData }) {
  const dialog = useDialog();
  const router = useRouter();
  const [ending, setEnding] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function endSession() {
    const ok = await dialog.confirm({ title: "자율 풀이 세션을 마감할까요?", description: "마감하면 PIN으로 더 이상 참여할 수 없습니다.", danger: true, confirmLabel: "마감" });
    if (!ok) return;
    setEnding(true); setError(null);
    const response = await fetch(`/api/quiz/sessions/${initial.id}/end`, { method: "POST" });
    const data = await response.json();
    if (!response.ok) { setEnding(false); setError(data.error ?? "세션을 마감하지 못했습니다."); return; }
    router.push(`/quiz/activities/${initial.id}/report`);
  }

  return (
    <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,1fr)_340px]">
      <section className="space-y-4">
        <div className="rounded-[28px] border border-line bg-surface p-6 sm:p-8">
          <div className="flex flex-col gap-5 sm:flex-row sm:items-center sm:justify-between">
            <div><div className="flex items-center gap-2"><StatusBadge status="ASYNC" /><StatusBadge status={initial.status} /></div><h2 className="mt-4 text-xl font-black tracking-tight text-content">학생 참여 현황</h2><p className="mt-2 text-sm text-content-muted">새로고침하면 최신 진행 상태를 확인할 수 있어요.</p></div>
            <button type="button" onClick={() => router.refresh()} className="rounded-xl border border-line bg-surface px-4 py-2.5 text-sm font-black text-content-muted hover:border-brand-300">현황 새로고침</button>
          </div>
          {initial.participants.length > 0 ? <div className="mt-6 overflow-x-auto"><table className="w-full min-w-[560px] text-left"><thead><tr className="border-b border-line text-[11px] font-black uppercase tracking-wider text-content-subtle"><th className="pb-3">학생</th><th className="pb-3">상태</th><th className="pb-3">진행률</th><th className="pb-3 text-right">점수</th></tr></thead><tbody>{initial.participants.map((participant) => <tr key={participant.id} className="border-b border-line last:border-0"><td className="py-4"><p className="text-sm font-black text-content">{participant.nickname}</p><p className="mt-1 text-[11px] text-content-subtle">{formatDateTime(participant.joinedAt)} 참여</p></td><td className="py-4"><StatusBadge status={participant.status} /></td><td className="py-4"><div className="flex items-center gap-3"><div className="h-2 w-24 overflow-hidden rounded-full bg-surface-muted"><div className="h-full rounded-full bg-brand" style={{ width: `${initial.totalQuestions ? Math.min(100, participant.currentQuestionIndex / initial.totalQuestions * 100) : 0}%` }} /></div><span className="text-xs font-bold text-content-muted">{participant.currentQuestionIndex}/{initial.totalQuestions}</span></div></td><td className="py-4 text-right text-sm font-black text-content">{participant.score.toLocaleString("ko-KR")}</td></tr>)}</tbody></table></div> : <div className="mt-6 rounded-2xl border border-dashed border-line-strong bg-surface-muted py-12 text-center"><UsersIcon className="mx-auto h-7 w-7 text-content-subtle" /><p className="mt-3 text-sm font-black text-content-muted">아직 참여한 학생이 없어요</p><p className="mt-1 text-xs text-content-subtle">아래 PIN을 학생들에게 공유해 주세요.</p></div>}
        </div>
      </section>

      <aside className="space-y-4 lg:sticky lg:top-24">
        {/* 어두운 브랜드 카드 위의 글자는 --brand-fg를 씁니다. text-white로 두면 다크 모드에서
            카드 배경이 밝아졌을 때 대비가 깨지고, 라임 강조는 몰입 화면의 무대색이라 일반
            작업 화면에 섞이면 두 색 체계가 한 화면에 나옵니다. */}
        <div className="overflow-hidden rounded-[28px] bg-brand-950 text-on-brand shadow-xl shadow-brand-950/10"><div className="soft-dots p-6"><p className="text-xs font-black uppercase tracking-[0.18em] text-brand-300">Join PIN</p><p className="mt-3 font-mono text-5xl font-black tracking-[0.12em] text-brand-fg">{initial.pinCode ?? "마감"}</p><p className="mt-3 text-xs leading-5 text-brand-100/70">{initial.requiresLogin ? "학생은 QR을 스캔하고 로그인하면 이 세션으로 돌아옵니다." : "누구나 QR을 스캔하고 닉네임만 입력해 참여합니다."}</p>{initial.pinCode ? <><CopyButton value={initial.pinCode} label="PIN 복사" className="mt-5 w-full bg-brand-300 px-4 py-3 text-brand-950 hover:bg-brand-200" /><div className="mt-4"><JoinQrCode pin={initial.pinCode} requiresLogin={initial.requiresLogin} sessionId={initial.id} compact /></div></> : null}</div></div>
        <div className="rounded-[24px] border border-line bg-surface p-5"><h3 className="text-sm font-black text-content">세션 설정</h3><dl className="mt-4 space-y-3 text-xs"><div className="flex items-center justify-between gap-3"><dt className="flex items-center gap-2 text-content-subtle"><UsersIcon className="h-4 w-4" />참여 인원</dt><dd className="font-black text-content">{initial.participantCount}명</dd></div><div className="flex items-center justify-between gap-3"><dt className="flex items-center gap-2 text-content-subtle"><SessionIcon className="h-4 w-4" />문항</dt><dd className="font-black text-content">{initial.totalQuestions}개</dd></div>{initial.openAt && <div className="flex items-center justify-between gap-3"><dt className="flex items-center gap-2 text-content-subtle"><ClockIcon className="h-4 w-4" />공개</dt><dd className="text-right font-black text-content">{formatDateTime(initial.openAt)}</dd></div>}{initial.dueAt && <div className="flex items-center justify-between gap-3"><dt className="flex items-center gap-2 text-content-subtle"><ClockIcon className="h-4 w-4" />마감</dt><dd className="text-right font-black text-content">{formatDateTime(initial.dueAt)}</dd></div>}</dl></div>
        {error && <InlineNotice tone="error">{error}</InlineNotice>}
        {initial.status !== "FINISHED" && <button type="button" onClick={endSession} disabled={ending} className="w-full rounded-xl border border-danger/25 bg-surface px-5 py-3 text-sm font-black text-danger hover:bg-danger-soft disabled:opacity-50">{ending ? "마감 중..." : "세션 마감하고 결과 보기"}</button>}
      </aside>
    </div>
  );
}
