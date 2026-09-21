"use client";

import { useCallback, useEffect, useState } from "react";
import { Copy, Link2, Trash2 } from "lucide-react";
import { useConfirm } from "@/components/ui/app-dialog";
import { requestJson } from "@/lib/api-client";

type InviteLinkDTO = {
  id: string;
  role: "MEMBER" | "VIEWER";
  expiresAt: string | null;
  maxUses: number | null;
  useCount: number;
  revokedAt: string | null;
  createdAt: string;
};

export function PadInviteLinks({ boardId }: { boardId: string }) {
  const confirm = useConfirm();
  const [links, setLinks] = useState<InviteLinkDTO[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [page, setPage] = useState(1);
  const [totalCount, setTotalCount] = useState(0);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState("");
  const [freshUrl, setFreshUrl] = useState("");

  const load = useCallback((nextPage = 1, append = false, signal?: AbortSignal) => {
    fetch(`/api/boards/${boardId}/invite-links?page=${nextPage}`, { signal })
      .then((response) => response.ok ? response.json() : { inviteLinks: [] })
      .then((result) => {
        setLinks((current) => append ? [...current, ...result.inviteLinks.filter((link: InviteLinkDTO) => !current.some((item) => item.id === link.id))] : result.inviteLinks);
        setPage(result.page ?? nextPage);
        setTotalCount(result.totalCount ?? result.inviteLinks.length);
      })
      .catch(() => { if (!signal?.aborted) setError("초대 링크를 불러오지 못했습니다."); })
      .finally(() => { if (!signal?.aborted) { setLoading(false); setLoadingMore(false); } });
  }, [boardId]);

  useEffect(() => {
    const controller = new AbortController();
    load(1, false, controller.signal);
    return () => controller.abort();
  }, [load]);

  async function createLink(role: "MEMBER" | "VIEWER") {
    setCreating(true);
    setError("");
    try {
      const result = await requestJson<{ token: string }>(`/api/boards/${boardId}/invite-links`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ role }),
      });
      const url = `${window.location.origin}/i/${result.token}`;
      setFreshUrl(url);
      await navigator.clipboard.writeText(url).catch(() => undefined);
      load();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "초대 링크를 만들지 못했습니다.");
    } finally {
      setCreating(false);
    }
  }

  async function revoke(linkId: string) {
    if (!(await confirm("이 초대 링크를 폐기할까요? 이후에는 이 링크로 참여할 수 없어요."))) return;
    try {
      await requestJson(`/api/boards/${boardId}/invite-links/${linkId}`, { method: "DELETE" });
    } catch (reason) {
      return setError(reason instanceof Error ? reason.message : "초대 링크를 폐기하지 못했습니다.");
    }
    load();
  }

  const roleLabel = { MEMBER: "멤버", VIEWER: "읽기 전용" };

  return (
    <section className="invite-link-settings">
      <header><span><Link2 size={16} /><b>초대 링크</b></span></header>
      <div className="invite-link-actions">
        <button type="button" className="button soft" onClick={() => createLink("MEMBER")} disabled={creating}>멤버용 링크 만들기</button>
        <button type="button" className="button soft" onClick={() => createLink("VIEWER")} disabled={creating}>읽기 전용 링크 만들기</button>
      </div>
      {freshUrl && <p className="invite-link-fresh"><Copy size={13} />링크가 복사되었어요: {freshUrl}</p>}
      {error && <p className="form-error compact">{error}</p>}
      {!loading && links.length > 0 && (
        <ul className="invite-link-list">
          {links.map((link) => (
            <li key={link.id} className={link.revokedAt ? "revoked" : ""}>
              <span>{roleLabel[link.role]}{link.maxUses ? ` · ${link.useCount}/${link.maxUses}회 사용` : ` · ${link.useCount}회 사용`}{link.expiresAt ? ` · ${new Intl.DateTimeFormat("ko", { month: "numeric", day: "numeric", timeZone: "Asia/Seoul" }).format(new Date(link.expiresAt))}까지` : ""}{link.revokedAt ? " · 폐기됨" : ""}</span>
              {!link.revokedAt && <button type="button" className="member-remove" onClick={() => revoke(link.id)} aria-label="초대 링크 폐기"><Trash2 size={14} /></button>}
            </li>
          ))}
          {links.length < totalCount && <li><button type="button" className="button ghost full" disabled={loadingMore} onClick={() => { setLoadingMore(true); load(page + 1, true); }}>{loadingMore ? "불러오는 중…" : `초대 링크 더 보기 (${links.length}/${totalCount})`}</button></li>}
        </ul>
      )}
    </section>
  );
}
