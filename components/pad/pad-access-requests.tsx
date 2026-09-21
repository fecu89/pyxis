"use client";

import { useEffect, useState } from "react";
import { Check, Clock3, UserRoundCheck, X } from "lucide-react";
import { Avatar } from "@/components/ui/avatar";

type AccessRequestSummary = {
  id: string;
  status: "PENDING";
  createdAt: string;
  updatedAt: string;
  user: {
    id: string;
    name: string | null;
    loginIdentifier: string;
    image: string | null;
  };
};

export function PadAccessRequests({ boardId, requestId, onResolved }: {
  boardId: string;
  requestId?: string;
  onResolved?: () => void;
}) {
  const [requests, setRequests] = useState<AccessRequestSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [page, setPage] = useState(1);
  const [totalCount, setTotalCount] = useState(0);
  const [actionId, setActionId] = useState<string | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    const controller = new AbortController();

    async function loadRequests() {
      try {
        const query = requestId ? `?requestId=${encodeURIComponent(requestId)}` : "";
        const response = await fetch(`/api/boards/${boardId}/access-requests${query}`, {
          signal: controller.signal,
        });
        const result = await response.json();
        if (!response.ok) throw new Error(result.error ?? "접근 요청을 불러오지 못했습니다.");
        setRequests(result.requests);
        setPage(result.page);
        setTotalCount(result.totalCount);
      } catch (loadError) {
        if (!controller.signal.aborted) {
          setError(loadError instanceof Error ? loadError.message : "접근 요청을 불러오지 못했습니다.");
        }
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    }

    void loadRequests();
    return () => controller.abort();
  }, [boardId, requestId]);

  async function decide(requestId: string, action: "APPROVE" | "REJECT") {
    setActionId(requestId);
    setError("");
    try {
      const response = await fetch("/api/boards/" + boardId + "/access-requests", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ requestId, action }),
      });
      const result = await response.json();
      if (!response.ok) {
        setError(result.error ?? "접근 요청을 처리하지 못했습니다.");
        return;
      }
      setRequests((current) => current.filter((item) => item.id !== requestId));
      setTotalCount((current) => Math.max(0, current - 1));
      onResolved?.();
    } catch {
      setError("네트워크 오류로 접근 요청을 처리하지 못했습니다.");
    } finally {
      setActionId(null);
    }
  }

  async function loadMore() {
    setLoadingMore(true);
    setError("");
    try {
      const response = await fetch(`/api/boards/${boardId}/access-requests?page=${page + 1}`);
      const result = await response.json();
      if (!response.ok) throw new Error(result.error ?? "접근 요청을 더 불러오지 못했습니다.");
      setRequests((current) => [...current, ...result.requests.filter((request: AccessRequestSummary) => !current.some((item) => item.id === request.id))]);
      setPage(result.page);
      setTotalCount(result.totalCount);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "접근 요청을 더 불러오지 못했습니다.");
    } finally {
      setLoadingMore(false);
    }
  }

  return (
    <section className="access-request-settings" aria-labelledby="access-requests-title">
      <header>
        <span><UserRoundCheck size={16} /><b id="access-requests-title">접근 요청</b></span>
        {!loading && <span className="request-count">{totalCount}</span>}
      </header>
      {loading ? (
        <p className="request-empty"><Clock3 size={15} />대기 요청을 확인하는 중...</p>
      ) : requests.length ? (
        <div className="request-list">
          {requests.map((request) => (
            <article key={request.id}>
              <Avatar name={request.user.name} identifier={request.user.loginIdentifier} image={request.user.image} />
              <span className="request-user">
                <b>{request.user.name || "이름 없음"}</b>
                <small>{request.user.loginIdentifier}</small>
              </span>
              <div className="request-actions">
                <button type="button" className="request-approve" onClick={() => decide(request.id, "APPROVE")} disabled={actionId === request.id} aria-label={(request.user.name || request.user.loginIdentifier) + " 접근 승인"}><Check size={15} />승인</button>
                <button type="button" className="request-reject" onClick={() => decide(request.id, "REJECT")} disabled={actionId === request.id} aria-label={(request.user.name || request.user.loginIdentifier) + " 접근 거절"}><X size={15} />거절</button>
              </div>
            </article>
          ))}
          {requests.length < totalCount && <button type="button" className="button ghost full" disabled={loadingMore} onClick={loadMore}>{loadingMore ? "불러오는 중…" : `요청 더 보기 (${requests.length}/${totalCount})`}</button>}
        </div>
      ) : (
        <p className="request-empty">{requestId ? "이 접근 요청은 이미 처리되었습니다." : "대기 중인 접근 요청이 없습니다."}</p>
      )}
      {error && <p className="form-error compact">{error}</p>}
    </section>
  );
}
