"use client";

import { useCallback, useEffect, useId, useMemo, useState } from "react";
import { LoaderCircle, Search, Users } from "lucide-react";
import { Modal } from "@/components/ui/modal";
import { InlineNotice } from "@/components/ui/feedback";
import { SelectableList } from "@/components/ui/selectable-list";

// 설문 소유자가 다른 교사에게 보기·편집 권한을 주는 다이얼로그입니다.
// `app/api/quiz/quizzes/[quizId]/shares/*`와 짝을 이루는 `app/api/forms/[formId]/shares/*`를
// 부릅니다. 개요 화면의 버튼과 설문 목록 카드의 옵션 메뉴가 같은 다이얼로그를 엽니다.

type ShareTeacher = { id: string; name: string | null; maskedLoginIdentifier: string | null };
type ShareData = { shares: Array<{ permission: "EDITOR" | "VIEWER"; user: ShareTeacher }>; candidates: ShareTeacher[] };

export function FormCollaboratorDialogButton({ formId, formTitle, compact = false }: { formId: string; formTitle: string; compact?: boolean }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label="공동 작업자 관리"
        title="공동 작업자 관리"
        className={compact
          ? "inline-flex h-full min-w-0 flex-1 items-center justify-center gap-2 rounded-lg border border-line bg-surface px-2 text-xs font-black text-content-muted shadow-sm transition hover:border-brand-300 hover:bg-surface-hover hover:text-brand sm:flex-none sm:px-4"
          : "inline-flex min-h-11 items-center gap-2 rounded-lg border border-line px-4 text-sm font-black text-content-muted transition hover:border-brand-300 hover:text-brand"}
      >
        <Users className="h-4 w-4" aria-hidden /><span className={compact ? "hidden sm:inline" : undefined}>공동 작업자</span>
      </button>
      <FormCollaboratorDialog formId={formId} formTitle={formTitle} open={open} onClose={() => setOpen(false)} />
    </>
  );
}

export function FormCollaboratorDialog({ formId, formTitle, open, onClose }: { formId: string; formTitle: string; open: boolean; onClose: () => void }) {
  const [data, setData] = useState<ShareData | null>(null);
  const [search, setSearch] = useState("");
  const [selectedTeacher, setSelectedTeacher] = useState<Set<string>>(() => new Set());
  const [permission, setPermission] = useState<"EDITOR" | "VIEWER">("VIEWER");
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const searchInputId = useId();

  // 열 때(open이 true가 되는 순간)마다 목록을 다시 받아옵니다. submit/remove 뒤의 재조회는
  // 이벤트 핸들러 안에서 아래 load()를 직접 부릅니다 — 이펙트 안에서 부르면(과거에 그랬듯)
  // react-hooks/set-state-in-effect에 걸리므로, 이펙트는 fetch를 직접 인라인합니다.
  const load = useCallback(async () => {
    try {
      const response = await fetch(`/api/forms/${formId}/shares`);
      const result = await response.json().catch(() => ({}));
      if (!response.ok) { setError(typeof result.error === "string" ? result.error : "공동 작업자 정보를 불러오지 못했습니다."); return; }
      setData(result as ShareData);
    } catch {
      setError("네트워크 연결을 확인한 뒤 다시 시도해 주세요.");
    }
  }, [formId]);

  useEffect(() => {
    if (!open) return;
    const controller = new AbortController();
    fetch(`/api/forms/${formId}/shares`, { signal: controller.signal })
      .then(async (response) => ({ ok: response.ok, data: await response.json().catch(() => ({})) }))
      .then(({ ok, data }) => {
        if (controller.signal.aborted) return;
        if (!ok) { setError(typeof data.error === "string" ? data.error : "공동 작업자 정보를 불러오지 못했습니다."); return; }
        setData(data as ShareData);
      })
      .catch(() => { if (!controller.signal.aborted) setError("네트워크 연결을 확인한 뒤 다시 시도해 주세요."); });
    return () => controller.abort();
  }, [open, formId]);

  // 이미 공동 작업자인 교사도 후보에서 빼지 않고 배지만 붙입니다 — POST가 upsert라 다시
  // 골라 권한만 바꿀 수 있어야 합니다.
  const shareByUserId = useMemo(() => new Map((data?.shares ?? []).map((share) => [share.user.id, share.permission])), [data]);

  // 후보는 이미 최대 300명까지 GET 한 번으로 받아 두었으므로(shares API), 검색어가 바뀔
  // 때마다 서버를 다시 부르지 않고 이 배열만 클라이언트에서 거릅니다. 새 API 호출은 없습니다.
  const teacherItems = useMemo(() => {
    const query = search.trim().toLowerCase();
    const candidates = data?.candidates ?? [];
    const matched = query
      ? candidates.filter((candidate) => (candidate.name ?? "").toLowerCase().includes(query) || (candidate.maskedLoginIdentifier ?? "").toLowerCase().includes(query))
      : candidates;
    return matched.map((candidate) => {
      const existingPermission = shareByUserId.get(candidate.id);
      return {
        id: candidate.id,
        title: candidate.name || candidate.maskedLoginIdentifier || "교사",
        meta: candidate.maskedLoginIdentifier,
        badge: existingPermission ? <em className="select-row-flag">공유 중 · {existingPermission === "EDITOR" ? "편집자" : "보기"}</em> : null,
      };
    });
  }, [data, search, shareByUserId]);

  const userId = selectedTeacher.size ? [...selectedTeacher][0] : "";

  async function submit() {
    if (!userId) return;
    setPending(true);
    setError(null);
    try {
      const response = await fetch(`/api/forms/${formId}/shares`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userId, permission }),
      });
      const result = await response.json().catch(() => ({}));
      if (!response.ok) { setError(typeof result.error === "string" ? result.error : "권한을 부여하지 못했습니다."); return; }
      setSelectedTeacher(new Set());
      await load();
    } catch {
      setError("네트워크 연결을 확인한 뒤 다시 시도해 주세요.");
    } finally {
      setPending(false);
    }
  }

  async function remove(targetId: string) {
    setError(null);
    try {
      const response = await fetch(`/api/forms/${formId}/shares/${targetId}`, { method: "DELETE" });
      const result = await response.json().catch(() => ({}));
      if (!response.ok) { setError(typeof result.error === "string" ? result.error : "공동 작업자를 제거하지 못했습니다."); return; }
      await load();
    } catch {
      setError("네트워크 연결을 확인한 뒤 다시 시도해 주세요.");
    }
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="공동 작업자"
      description="다른 교사에게 설문 보기 또는 편집 권한을 부여합니다. 응답자 링크 공유와는 별개입니다."
    >
      <div className="p-5 sm:p-6">
        <p className="mb-4 truncate text-sm font-black text-content">{formTitle || "제목 없는 설문지"}</p>
        {error && <div className="mb-4"><InlineNotice tone="error">{error}</InlineNotice></div>}

        <div className="rounded-lg bg-surface-inset p-4">
          <p className="text-xs font-black text-content-muted">교사 선택</p>
          <div className="mt-2 select-controls">
            <div className="select-search">
              <Search size={15} aria-hidden />
              <label htmlFor={searchInputId} className="sr-only">이름·아이디로 교사 검색</label>
              <input id={searchInputId} value={search} onChange={(event) => setSearch(event.target.value)} placeholder="이름·아이디로 교사 검색" />
            </div>
          </div>
          <SelectableList
            selectionMode="single"
            toolbar={false}
            items={teacherItems}
            selected={selectedTeacher}
            onSelectionChange={(next) => setSelectedTeacher(next)}
            unitLabel="교사"
            unitSuffix="명"
            emptyLabel="일치하는 교사가 없습니다."
            ariaLabel="공유할 교사 선택"
          />
          <fieldset className="mt-4">
            <legend className="text-xs font-black text-content-muted">권한</legend>
            <div className="mt-2 grid grid-cols-2 gap-2">
              {(["VIEWER", "EDITOR"] as const).map((option) => (
                <label
                  key={option}
                  className={`cursor-pointer rounded-lg border p-3 ${permission === option ? "border-brand-500 bg-brand-soft/40" : "border-line"}`}
                >
                  <input type="radio" className="sr-only" checked={permission === option} onChange={() => setPermission(option)} />
                  <b className="text-sm">{option === "VIEWER" ? "보기" : "편집자"}</b>
                  <span className="mt-1 block text-[11px] text-content-muted">{option === "VIEWER" ? "질문·응답 확인" : "질문 수정·발행·응답 확인"}</span>
                </label>
              ))}
            </div>
          </fieldset>
          <button
            type="button"
            onClick={() => void submit()}
            disabled={!userId || pending}
            className="mt-4 min-h-11 w-full rounded-lg bg-brand-strong text-sm font-black text-on-brand disabled:opacity-40"
          >
            {pending ? "추가 중..." : "공동 작업자로 추가"}
          </button>
        </div>

        <div className="mt-5">
          <h3 className="text-xs font-black text-content-muted">현재 공동 작업자</h3>
          {data === null ? (
            error ? null : (
              <p role="status" className="mt-3 flex items-center gap-2 text-sm font-bold text-content-subtle">
                <LoaderCircle className="h-4 w-4 animate-spin" aria-hidden />공동 작업자를 불러오는 중...
              </p>
            )
          ) : data.shares.length ? (
            <ul className="mt-2 space-y-2">
              {data.shares.map((share) => (
                <li key={share.user.id} className="flex items-center gap-3 rounded-lg bg-surface px-4 py-3 ring-1 ring-line">
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-black text-content">{share.user.name || share.user.maskedLoginIdentifier || "교사"}</p>
                    <p className="mt-0.5 text-[11px] font-bold text-content-subtle">{share.permission === "EDITOR" ? "편집자" : "보기"}</p>
                  </div>
                  <button type="button" onClick={() => void remove(share.user.id)} className="rounded-lg px-2 py-1 text-xs font-black text-danger hover:bg-danger-soft">제거</button>
                </li>
              ))}
            </ul>
          ) : (
            <p className="mt-3 text-sm font-bold text-content-subtle">아직 추가한 공동 작업자가 없습니다.</p>
          )}
        </div>
      </div>
    </Modal>
  );
}
