"use client";

import { useEffect, useRef, useState } from "react";
import { BadgeCheck, Building2, Clock3, LoaderCircle, School, X } from "lucide-react";
import { approveSelectedRequests, submitApprovalReview, type ApprovalAction } from "@/components/admin/shared/approval-client";
import { AdminPageNavigation } from "@/components/admin/shared/admin-pagination";
import type { TeacherApprovalRecord } from "@/components/admin/types";
import { useConfirm } from "@/components/ui/app-dialog";
import { SelectableList } from "@/components/ui/selectable-list";

const KOREAN_DATE_TIME = new Intl.DateTimeFormat("ko-KR", {
  dateStyle: "medium",
  timeStyle: "short",
  timeZone: "Asia/Seoul",
});

export function TeacherApprovalQueue({
  initialRequests,
  initialTotalCount,
  initialPage,
  initialPageSize,
  onCountChanged,
  onAuditChanged,
}: {
  initialRequests: TeacherApprovalRecord[];
  initialTotalCount: number;
  initialPage: number;
  initialPageSize: number;
  onCountChanged?: (count: number) => void;
  onAuditChanged?: () => void;
}) {
  const confirm = useConfirm();
  const [requests, setRequests] = useState(initialRequests);
  const [totalCount, setTotalCount] = useState(initialTotalCount);
  const [page, setPage] = useState(initialPage);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [pending, setPending] = useState(false);
  const [processing, setProcessing] = useState<{ id: string | null; action: ApprovalAction } | null>(null);
  const [error, setError] = useState("");
  const listControllerRef = useRef<AbortController | null>(null);
  const totalPages = Math.max(1, Math.ceil(totalCount / initialPageSize));

  useEffect(() => () => listControllerRef.current?.abort(), []);

  async function load(targetPage: number) {
    listControllerRef.current?.abort();
    const controller = new AbortController();
    listControllerRef.current = controller;
    setPending(true);
    setError("");
    try {
      const response = await fetch(
        `/api/admin/teacher-approvals?page=${targetPage}&pageSize=${initialPageSize}`,
        { cache: "no-store", signal: controller.signal },
      );
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "교사 가입 요청을 불러오지 못했습니다.");
      setRequests(result.requests);
      setTotalCount(result.totalCount);
      setPage(result.page);
      onCountChanged?.(result.totalCount);
    } catch (loadError) {
      if (loadError instanceof DOMException && loadError.name === "AbortError") return;
      setError(loadError instanceof Error ? loadError.message : "교사 가입 요청을 불러오지 못했습니다.");
    } finally {
      if (listControllerRef.current === controller) {
        listControllerRef.current = null;
        setPending(false);
      }
    }
  }

  async function submitReview(request: TeacherApprovalRecord, action: ApprovalAction) {
    const approved = action === "APPROVE";
    if (!(await confirm({
      description: `${request.user.name || request.user.loginIdentifier}님의 교사 신청을 ${approved ? "승인" : "반려"}할까요?`,
      confirmLabel: approved ? "교사로 승인" : "신청 반려",
      danger: !approved,
    }))) return;
    setProcessing({ id: request.id, action });
    setPending(true);
    setError("");
    try {
      await submitApprovalReview(
        `/api/admin/teacher-approvals/${request.id}`,
        action,
        `관리자 교사 신청 ${approved ? "승인" : "반려"}`,
      );
      setSelectedIds((current) => {
        const next = new Set(current);
        next.delete(request.id);
        return next;
      });
      const nextCount = Math.max(0, totalCount - 1);
      const nextPage = Math.min(page, Math.max(1, Math.ceil(nextCount / initialPageSize)));
      setTotalCount(nextCount);
      onCountChanged?.(nextCount);
      onAuditChanged?.();
      await load(nextPage);
    } catch (reviewError) {
      setError(reviewError instanceof Error ? reviewError.message : "교사 가입 요청을 처리하지 못했습니다.");
    } finally {
      setProcessing(null);
      setPending(false);
    }
  }

  async function approveSelected() {
    const ids = Array.from(selectedIds);
    if (!ids.length) return;
    if (!(await confirm({
      description: `선택한 교사 가입 요청 ${ids.length}건을 한꺼번에 승인할까요?`,
      confirmLabel: `${ids.length}건 승인`,
    }))) return;
    setProcessing({ id: null, action: "APPROVE" });
    setPending(true);
    setError("");
    try {
      const result = await approveSelectedRequests(
        ids,
        (id) => `/api/admin/teacher-approvals/${id}`,
        `관리자 교사 가입 요청 일괄 승인 (${ids.length}건)`,
      );
      setSelectedIds(new Set());
      const nextCount = Math.max(0, totalCount - result.approvedIds.length);
      const nextPage = Math.min(page, Math.max(1, Math.ceil(nextCount / initialPageSize)));
      setTotalCount(nextCount);
      onCountChanged?.(nextCount);
      if (result.approvedIds.length) onAuditChanged?.();
      await load(nextPage);
      if (result.failed.length) setError(`${result.approvedIds.length}건을 승인했고 ${result.failed.length}건은 이미 처리됐거나 권한 조건이 맞지 않았습니다.`);
    } finally {
      setProcessing(null);
      setPending(false);
    }
  }

  return (
    <section className="admin-panel admin-approval-panel" aria-labelledby="teacher-approval-title">
      <header className="admin-panel-header">
        <div>
          <span className="admin-kicker">TEACHER VERIFICATION</span>
          <h2 id="teacher-approval-title">교사 가입 요청</h2>
          <p>학교와 부서를 확인한 뒤 교사 권한을 승인하거나 반려합니다.</p>
        </div>
        <button type="button" className="button ghost" disabled={pending} onClick={() => void load(page)}>
          {pending && !processing ? <LoaderCircle size={15} className="spin" aria-hidden /> : <Clock3 size={15} aria-hidden />}새로고침
        </button>
      </header>

      {error && <p className="admin-global-error" role="alert">{error}</p>}
      {requests.length ? (
        <div className="admin-approval-select-list">
          <SelectableList
            items={requests.map((request) => ({
              id: request.id,
              title: request.user.name || "이름 없음",
              meta: request.user.loginIdentifier,
              badge: <div className="admin-approval-row-details">
                <div className="admin-approval-placement">
                  <span><School size={14} aria-hidden /><small>학교</small><b>{request.school.name}</b></span>
                  <span><Building2 size={14} aria-hidden /><small>부서</small><b>{request.schoolGroup.name}</b></span>
                </div>
                <time dateTime={request.requestedAt}>{KOREAN_DATE_TIME.format(new Date(request.requestedAt))}</time>
                <div className="admin-approval-actions">
                  <button type="button" className="button soft" disabled={pending} onClick={() => void submitReview(request, "REJECT")}>{processing?.id === request.id && processing.action === "REJECT" ? <LoaderCircle size={15} className="spin" aria-hidden /> : <X size={15} aria-hidden />}반려</button>
                  <button type="button" className="button primary" disabled={pending} onClick={() => void submitReview(request, "APPROVE")}>{processing?.id === request.id && processing.action === "APPROVE" ? <LoaderCircle size={15} className="spin" aria-hidden /> : <BadgeCheck size={15} aria-hidden />}승인</button>
                </div>
              </div>,
            }))}
            selected={selectedIds}
            onSelectionChange={(next) => setSelectedIds(next)}
            busy={pending}
            unitLabel="요청"
            unitSuffix="건"
            emptyLabel="대기 중인 교사 가입 요청이 없습니다."
            ariaLabel="교사 가입 요청 선택"
            toolbarActions={<button type="button" className="select-toolbar-button admin-approval-bulk-approve" onClick={() => void approveSelected()} disabled={pending || selectedIds.size === 0}>{processing?.id === null ? <LoaderCircle size={13} className="spin" aria-hidden /> : <BadgeCheck size={13} aria-hidden />}선택 승인</button>}
          />
        </div>
      ) : (
        <div className="admin-approval-empty">
          <span><BadgeCheck size={24} aria-hidden /></span>
          <b>대기 중인 교사 가입 요청이 없습니다.</b>
          <p>새 신청이 들어오면 이곳에서 학교와 부서를 확인할 수 있습니다.</p>
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
