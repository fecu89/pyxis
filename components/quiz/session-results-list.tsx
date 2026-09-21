"use client";

import Link from "next/link";
import { useDialog } from "@/components/ui/app-dialog";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowRightIcon, GlobeIcon, LockIcon, SessionIcon, TrashIcon, XIcon } from "@/components/ui/icons";
import { CopyButton } from "@/components/ui/copy-button";
import { StatusBadge } from "@/components/ui/data-display";
import { InlineNotice } from "@/components/ui/feedback";
import { formatDateTime } from "@/lib/format";

export type SessionResultItem = {
  id: string;
  mode: "LIVE" | "ASYNC";
  status: string;
  pinCode: string | null;
  requiresLogin: boolean;
  createdAt: string;
  quizTitle: string;
  participantCount: number;
  answerCount: number;
};

// 결과 목록 + 개별/일괄 삭제. 진행 중(LOBBY·IN_PROGRESS)인 세션은 참여자 화면이 붕 뜨지 않도록
// 삭제 대상에서 제외합니다 — 먼저 종료하면 삭제할 수 있습니다.
export function SessionResultsList({ sessions }: { sessions: SessionResultItem[] }) {
  const dialog = useDialog();
  const router = useRouter();
  const [items, setItems] = useState(sessions);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const deletable = (session: SessionResultItem) => session.status !== "LOBBY" && session.status !== "IN_PROGRESS";
  const deletableIds = items.filter(deletable).map((session) => session.id);
  const allSelected = deletableIds.length > 0 && deletableIds.every((id) => selected.has(id));
  // Shift 범위 선택의 기준점(마지막으로 일반/Ctrl 클릭한 카드).
  const [anchorIndex, setAnchorIndex] = useState<number | null>(null);

  // 체크박스 대신 카드 자체를 눌러 선택합니다. 관리 콘솔 회원 목록과 같은 관례:
  // 일반 클릭 = 이 카드만 선택(이미 이 카드만 선택돼 있으면 해제), Ctrl/Cmd = 개별 토글, Shift = 범위.
  function handleCardClick(event: React.MouseEvent, index: number, session: SessionResultItem) {
    if (!deletable(session)) return;
    // 카드 안의 결과 보기 링크·삭제 버튼·PIN 복사 클릭은 선택으로 해석하지 않습니다.
    if (event.target instanceof Element && event.target.closest("button, a, input")) return;
    const withMeta = event.metaKey || event.ctrlKey;
    if (event.shiftKey && anchorIndex !== null) {
      const [from, to] = anchorIndex < index ? [anchorIndex, index] : [index, anchorIndex];
      const range = items.slice(from, to + 1).filter(deletable).map((item) => item.id);
      setSelected((current) => (withMeta ? new Set([...current, ...range]) : new Set(range)));
      return;
    }
    if (withMeta) {
      setSelected((current) => {
        const next = new Set(current);
        if (next.has(session.id)) next.delete(session.id); else next.add(session.id);
        return next;
      });
      setAnchorIndex(index);
      return;
    }
    setSelected((current) => (current.size === 1 && current.has(session.id) ? new Set() : new Set([session.id])));
    setAnchorIndex(index);
  }

  async function removeOne(session: SessionResultItem) {
    const ok = await dialog.confirm({ title: `'${session.quizTitle}' 세션 결과를 삭제할까요?`, description: `참여 ${session.participantCount}명·응답 ${session.answerCount}개 기록이 함께 삭제되며 되돌릴 수 없습니다.`, danger: true, confirmLabel: "삭제" });
    if (!ok) return;
    setBusy(true);
    setError(null);
    try {
      const response = await fetch(`/api/quiz/sessions/${session.id}`, { method: "DELETE" });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) { setError(data.error ?? "세션을 삭제하지 못했습니다."); return; }
      setItems((current) => current.filter((item) => item.id !== session.id));
      setSelected((current) => { const next = new Set(current); next.delete(session.id); return next; });
      router.refresh();
    } catch {
      setError("네트워크 연결을 확인한 뒤 다시 시도해 주세요.");
    } finally {
      setBusy(false);
    }
  }

  async function removeSelected() {
    const ids = [...selected];
    if (ids.length === 0) return;
    const ok = await dialog.confirm({ title: `선택한 ${ids.length}개 세션 결과를 삭제할까요?`, description: "참여·응답 기록이 함께 삭제되며 되돌릴 수 없습니다.", danger: true, confirmLabel: "모두 삭제" });
    if (!ok) return;
    setBusy(true);
    setError(null);
    try {
      const response = await fetch("/api/quiz/sessions/bulk-delete", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ sessionIds: ids }) });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) { setError(data.error ?? "세션을 삭제하지 못했습니다."); return; }
      setItems((current) => current.filter((item) => !selected.has(item.id)));
      setSelected(new Set());
      if (data.skippedCount > 0) setError(`${data.deletedCount}개를 삭제했고, 진행 중이거나 권한이 없는 ${data.skippedCount}개는 건너뛰었습니다.`);
      router.refresh();
    } catch {
      setError("네트워크 연결을 확인한 뒤 다시 시도해 주세요.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div>
      {error ? <div className="mb-4"><InlineNotice tone="error">{error}</InlineNotice></div> : null}

      {deletableIds.length > 0 ? (
        <div className="mb-4 flex flex-wrap items-center gap-3 rounded-2xl border border-line bg-surface px-4 py-3">
          <button type="button" onClick={() => setSelected(allSelected ? new Set() : new Set(deletableIds))} className="inline-flex min-h-9 items-center gap-1.5 rounded-xl px-3 text-xs font-black text-content-muted transition hover:bg-surface-muted hover:text-brand">
            {allSelected ? "전체 해제" : "전체 선택"} <span className="font-bold text-content-subtle">(종료된 세션 {deletableIds.length}개)</span>
          </button>
          <span className="hidden text-[11px] font-semibold text-content-subtle lg:inline">카드 클릭 선택 · Shift 범위 · Ctrl 개별</span>
          <div className="flex-1" />
          {selected.size > 0 ? (
            <>
              <span className="text-xs font-black text-brand">{selected.size}개 선택됨</span>
              <button type="button" onClick={() => setSelected(new Set())} className="inline-flex min-h-9 items-center gap-1 rounded-xl px-3 text-xs font-black text-content-muted hover:bg-surface-muted"><XIcon className="h-3.5 w-3.5" />해제</button>
              <button type="button" onClick={() => void removeSelected()} disabled={busy} className="inline-flex min-h-9 items-center gap-1.5 rounded-xl bg-danger-soft px-4 text-xs font-black text-danger-soft-fg transition hover:brightness-95 disabled:opacity-40"><TrashIcon className="h-3.5 w-3.5" />{busy ? "삭제 중..." : "선택 삭제"}</button>
            </>
          ) : (
            <span className="text-[11px] font-bold text-content-subtle">체크한 결과를 한 번에 삭제할 수 있어요</span>
          )}
        </div>
      ) : null}

      <div className="space-y-3">
        {items.map((session, index) => {
          const href = session.status === "FINISHED" ? `/quiz/activities/${session.id}/report` : session.mode === "LIVE" ? `/quiz/host/${session.id}` : `/quiz/activities/${session.id}`;
          const canDelete = deletable(session);
          const isSelected = selected.has(session.id);
          return (
            <article
              key={session.id}
              onClick={(event) => handleCardClick(event, index, session)}
              onMouseDown={(event) => { if (event.shiftKey) event.preventDefault(); }}
              data-selected={isSelected || undefined}
              className={`rounded-[24px] border bg-surface p-5 transition sm:p-6 ${canDelete ? "cursor-pointer" : ""} ${isSelected ? "border-brand-400 bg-brand-soft/30 ring-1 ring-brand-400" : "border-line hover:border-brand-200"}`}
            >
              <div className="flex flex-col gap-5 sm:flex-row sm:items-center">
                <div className={`grid h-12 w-12 shrink-0 place-items-center rounded-2xl ${session.mode === "LIVE" ? "bg-accent-soft text-accent-soft-fg" : "bg-info-soft text-info-soft-fg"}`}><SessionIcon className="h-6 w-6" /></div>
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <StatusBadge status={session.mode} />
                    <StatusBadge status={session.status} />
                    <span className={`inline-flex items-center gap-1 rounded-full px-2 py-1 text-[10px] font-black ${session.requiresLogin ? "bg-brand-soft text-brand-soft-fg" : "bg-info-100 text-info-800 dark:bg-info-400/15 dark:text-info-300"}`}>{session.requiresLogin ? <LockIcon className="h-3 w-3" /> : <GlobeIcon className="h-3 w-3" />}{session.requiresLogin ? "로그인" : "공개"}</span>
                  </div>
                  <h2 className="mt-2 truncate text-lg font-black tracking-tight text-content">{session.quizTitle}</h2>
                  <p className="mt-1 text-xs text-content-subtle">{formatDateTime(session.createdAt)} 생성 · 참여 {session.participantCount}명 · 응답 {session.answerCount}개</p>
                </div>
                {session.pinCode && <div className="flex items-center gap-2 rounded-2xl bg-surface-muted px-4 py-3"><div><p className="text-[10px] font-black uppercase tracking-wider text-content-subtle">PIN</p><p className="font-mono text-lg font-black tracking-widest text-content">{session.pinCode}</p></div><CopyButton value={session.pinCode} label="" /></div>}
                <div className="flex shrink-0 items-center gap-2">
                  <Link href={href} prefetch={false} className="inline-flex min-h-11 items-center justify-center gap-1 rounded-xl border border-line px-4 py-3 text-sm font-black text-content-muted transition hover:border-brand-300 hover:text-brand">{session.status === "FINISHED" ? "결과 보기" : session.mode === "LIVE" ? "호스트 입장" : "진행 현황"}<ArrowRightIcon className="h-4 w-4" /></Link>
                  {canDelete ? (
                    <button type="button" onClick={() => void removeOne(session)} disabled={busy} title="이 세션 결과 삭제" aria-label={`${session.quizTitle} 세션 결과 삭제`} className="grid h-11 w-11 place-items-center rounded-xl border border-line text-content-subtle transition hover:border-danger-soft-fg/40 hover:bg-danger-soft hover:text-danger disabled:opacity-40"><TrashIcon className="h-4 w-4" /></button>
                  ) : null}
                </div>
              </div>
            </article>
          );
        })}
      </div>
    </div>
  );
}
