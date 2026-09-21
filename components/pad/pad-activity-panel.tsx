"use client";

import { useEffect, useState } from "react";
import { FilePlus2, MessageSquare, Pencil, ShieldCheck, Trash2, UserPlus2, UserRoundCheck, type LucideIcon } from "lucide-react";
import type { BoardActivityType } from "@/generated/prisma/client";

type ActivityDTO = {
  id: string;
  type: BoardActivityType;
  createdAt: string;
  actor: { id: string; name: string | null } | null;
  post: { id: string; title: string | null } | null;
};

const ICONS = {
  POST_CREATED: FilePlus2,
  POST_UPDATED: Pencil,
  POST_DELETED: Trash2,
  COMMENT_CREATED: MessageSquare,
  MEMBER_JOINED: UserPlus2,
  ACCESS_REQUEST_DECIDED: UserRoundCheck,
  POST_MODERATED: ShieldCheck,
} satisfies Record<BoardActivityType, LucideIcon>;

function describe(item: ActivityDTO) {
  const actor = item.actor?.name || "누군가";
  const post = item.post?.title ? `"${item.post.title}"` : "게시물";
  switch (item.type) {
    case "POST_CREATED": return `${actor}님이 ${post}을 작성했어요`;
    case "POST_UPDATED": return `${actor}님이 ${post}을 수정했어요`;
    case "POST_DELETED": return `${actor}님이 ${post}을 삭제했어요`;
    case "COMMENT_CREATED": return `${actor}님이 ${post}에 댓글을 남겼어요`;
    case "MEMBER_JOINED": return `${actor}님이 새 멤버를 패드에 추가했어요`;
    case "ACCESS_REQUEST_DECIDED": return `${actor}님이 접근 요청을 처리했어요`;
    case "POST_MODERATED": return `${actor}님이 ${post}의 승인 상태를 처리했어요`;
    default: return "활동이 있었어요";
  }
}

export function PadActivityPanel({ boardId, open }: { boardId: string; open: boolean }) {
  const [items, setItems] = useState<ActivityDTO[]>([]);
  const [actorFilter, setActorFilter] = useState("");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!open) return;
    const controller = new AbortController();
    async function load() {
      setLoading(true);
      try {
        const response = await fetch(`/api/boards/${boardId}/activity`, { signal: controller.signal });
        const result = response.ok ? await response.json() : { activities: [] };
        if (!controller.signal.aborted) setItems(result.activities);
      } catch {
        if (!controller.signal.aborted) setItems([]);
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    }
    void load();
    return () => controller.abort();
  }, [boardId, open]);

  const actorOptions = [...new Map(items.filter((item) => item.actor).map((item) => [item.actor!.id, item.actor!.name || "이름 없음"])).entries()];
  const filtered = actorFilter ? items.filter((item) => item.actor?.id === actorFilter) : items;

  return (
    <div className="activity-panel">
      {actorOptions.length > 1 && (
        <label className="activity-filter">
          작성자 필터
          <select value={actorFilter} onChange={(event) => setActorFilter(event.target.value)}>
            <option value="">전체</option>
            {actorOptions.map(([id, name]) => <option key={id} value={id}>{name}</option>)}
          </select>
        </label>
      )}
      {loading ? (
        <p className="activity-empty">불러오는 중...</p>
      ) : filtered.length ? (
        <ul className="activity-list">
          {filtered.map((item) => {
            const Icon = ICONS[item.type] ?? FilePlus2;
            return (
              <li key={item.id}>
                <span className="activity-icon"><Icon size={14} aria-hidden /></span>
                <span>{describe(item)}</span>
                <time>{new Intl.DateTimeFormat("ko", { month: "numeric", day: "numeric", hour: "numeric", minute: "2-digit", timeZone: "Asia/Seoul" }).format(new Date(item.createdAt))}</time>
              </li>
            );
          })}
        </ul>
      ) : (
        <p className="activity-empty">아직 활동이 없어요.</p>
      )}
    </div>
  );
}
