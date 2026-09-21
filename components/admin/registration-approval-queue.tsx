"use client";

import { useEffect, useRef, useState } from "react";
import { BadgeCheck, Clock3, KeyRound, LoaderCircle, Mail, UserCheck, X } from "lucide-react";
import { approveSelectedRequests, submitApprovalReview, type ApprovalAction } from "@/components/admin/shared/approval-client";
import { AdminPageNavigation } from "@/components/admin/shared/admin-pagination";
import { useConfirm } from "@/components/ui/app-dialog";
import { SelectableList } from "@/components/ui/selectable-list";
import type { RegistrationApprovalRecord } from "@/lib/users/registration-approvals";

const KOREAN_DATE_TIME = new Intl.DateTimeFormat("ko-KR", {
  dateStyle: "medium",
  timeStyle: "short",
  timeZone: "Asia/Seoul",
});

export function RegistrationApprovalQueue({
  initialRequests,
  initialTotalCount,
  initialPage,
  initialPageSize,
}: {
  initialRequests: RegistrationApprovalRecord[];
  initialTotalCount: number;
  initialPage: number;
  initialPageSize: number;
}) {
  const confirm = useConfirm();
  const [requests, setRequests] = useState(initialRequests);
  const [totalCount, setTotalCount] = useState(initialTotalCount);
  const [page, setPage] = useState(initialPage);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [pending, setPending] = useState(false);
  const [processing, setProcessing] = useState<{ id: string | null; action: ApprovalAction } | null>(null);
  const [error, setError] = useState("");
  const controllerRef = useRef<AbortController | null>(null);
  const totalPages = Math.max(1, Math.ceil(totalCount / initialPageSize));

  useEffect(() => () => controllerRef.current?.abort(), []);

  async function load(targetPage: number) {
    controllerRef.current?.abort();
    const controller = new AbortController();
    controllerRef.current = controller;
    setPending(true);
    setError("");
    try {
      const response = await fetch(`/api/admin/account-approvals?page=${targetPage}&pageSize=${initialPageSize}`, {
        cache: "no-store",
        signal: controller.signal,
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "가입 요청을 불러오지 못했습니다.");
      setRequests(result.requests);
      setTotalCount(result.totalCount);
      setPage(result.page);
    } catch (loadError) {
      if (loadError instanceof DOMException && loadError.name === "AbortError") return;
      setError(loadError instanceof Error ? loadError.message : "가입 요청을 불러오지 못했습니다.");
    } finally {
      if (controllerRef.current === controller) {
        controllerRef.current = null;
        setPending(false);
      }
    }
  }

  async function submitReview(request: RegistrationApprovalRecord, action: ApprovalAction) {
    const approved = action === "APPROVE";
    if (!(await confirm({
      description: `${request.name || request.loginIdentifier} 계정의 가입을 ${approved ? "승인" : "반려"}할까요?`,
      confirmLabel: approved ? "가입 승인" : "가입 반려",
      danger: !approved,
    }))) return;
    setProcessing({ id: request.id, action });
    setPending(true);
    setError("");
    try {
      await submitApprovalReview(
        `/api/admin/account-approvals/${request.id}`,
        action,
        `관리자 가입 ${approved ? "승인" : "반려"}`,
      );
      setSelectedIds((current) => {
        const next = new Set(current);
        next.delete(request.id);
        return next;
      });
      const nextCount = Math.max(0, totalCount - 1);
      const nextPage = Math.min(page, Math.max(1, Math.ceil(nextCount / initialPageSize)));
      await load(nextPage);
    } catch (reviewError) {
      setError(reviewError instanceof Error ? reviewError.message : "가입 요청을 처리하지 못했습니다.");
    } finally {
      setProcessing(null);
      setPending(false);
    }
  }

  async function approveSelected() {
    const ids = Array.from(selectedIds);
    if (!ids.length) return;
    if (!(await confirm({
      description: `선택한 가입 요청 ${ids.length}건을 한꺼번에 승인할까요?`,
      confirmLabel: `${ids.length}건 승인`,
    }))) return;
    setProcessing({ id: null, action: "APPROVE" });
    setPending(true);
    setError("");
    try {
      const result = await approveSelectedRequests(
        ids,
        (id) => `/api/admin/account-approvals/${id}`,
        `관리자 가입 요청 일괄 승인 (${ids.length}건)`,
      );
      setSelectedIds(new Set());
      const nextCount = Math.max(0, totalCount - result.approvedIds.length);
      const nextPage = Math.min(page, Math.max(1, Math.ceil(nextCount / initialPageSize)));
      await load(nextPage);
      if (result.failed.length) setError(`${result.approvedIds.length}건을 승인했고 ${result.failed.length}건은 이미 처리됐거나 권한 조건이 맞지 않았습니다.`);
    } finally {
      setProcessing(null);
      setPending(false);
    }
  }

  return (
    <section className="admin-panel admin-approval-panel" aria-labelledby="account-approval-title">
      <header className="admin-panel-header">
        <div>
          <span className="admin-kicker">ACCOUNT VERIFICATION</span>
          <h2 id="account-approval-title">새 계정 가입 요청</h2>
          <p>회원가입과 최초 카카오 로그인으로 만든 계정을 확인한 뒤 사용을 허가합니다.</p>
        </div>
        <button type="button" className="button ghost" disabled={pending} onClick={() => void load(page)}>
          {pending && !processing ? <LoaderCircle size={15} className="spin" aria-hidden /> : <Clock3 size={15} aria-hidden />}새로고침
        </button>
      </header>

      {error && <p className="admin-global-error" role="alert">{error}</p>}
      {requests.length ? (
        <div className="admin-approval-select-list">
          <SelectableList
            items={requests.map((request) => {
              const LoginIcon = request.loginType === "KAKAO_EMAIL" ? Mail : KeyRound;
              return {
                id: request.id,
                title: request.name || "프로필 설정 전",
                meta: request.loginIdentifier,
                badge: <div className="admin-approval-row-details">
                  <div className="admin-approval-placement">
                    <span><LoginIcon size={14} aria-hidden /><small>가입 방식</small><b>{request.loginType === "KAKAO_EMAIL" ? "카카오" : "아이디"}</b></span>
                  </div>
                  <time dateTime={request.requestedAt}>{KOREAN_DATE_TIME.format(new Date(request.requestedAt))}</time>
                  <div className="admin-approval-actions">
                    <button type="button" className="button soft" disabled={pending} onClick={() => void submitReview(request, "REJECT")}>{processing?.id === request.id && processing.action === "REJECT" ? <LoaderCircle size={15} className="spin" aria-hidden /> : <X size={15} aria-hidden />}반려</button>
                    <button type="button" className="button primary" disabled={pending} onClick={() => void submitReview(request, "APPROVE")}>{processing?.id === request.id && processing.action === "APPROVE" ? <LoaderCircle size={15} className="spin" aria-hidden /> : <UserCheck size={15} aria-hidden />}승인</button>
                  </div>
                </div>,
              };
            })}
            selected={selectedIds}
            onSelectionChange={(next) => setSelectedIds(next)}
            busy={pending}
            unitLabel="요청"
            unitSuffix="건"
            emptyLabel="대기 중인 가입 요청이 없습니다."
            ariaLabel="새 계정 가입 요청 선택"
            toolbarActions={<button type="button" className="select-toolbar-button admin-approval-bulk-approve" onClick={() => void approveSelected()} disabled={pending || selectedIds.size === 0}>{processing?.id === null ? <LoaderCircle size={13} className="spin" aria-hidden /> : <UserCheck size={13} aria-hidden />}선택 승인</button>}
          />
        </div>
      ) : (
        <div className="admin-approval-empty">
          <span><BadgeCheck size={24} aria-hidden /></span>
          <b>대기 중인 새 계정이 없습니다.</b>
          <p>새 회원가입이나 최초 카카오 로그인이 들어오면 이곳에 표시됩니다.</p>
        </div>
      )}

      {totalCount > 0 && (
        <footer className="admin-approval-pagination">
          <span>총 {totalCount}건</span>
          <AdminPageNavigation page={page} totalPages={totalPages} pending={pending} compact onPageChange={(nextPage) => void load(nextPage)} />
        </footer>
      )}
    </section>
  );
}
