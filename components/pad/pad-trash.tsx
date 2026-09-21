"use client";

import { useEffect, useState } from "react";
import { ArchiveRestore, Check, FileText, Folder, ListChecks, MessageCircle, RotateCcw, Trash2, X } from "lucide-react";
import { useConfirm } from "@/components/ui/app-dialog";

type TrashItem = { id: string; deletedAt: string; restorable: boolean; title?: string | null; body?: string; originalName?: string };
type TrashData = { sections: TrashItem[]; posts: TrashItem[]; comments: TrashItem[] };
type TrashKind = keyof TrashData;
type TrashTarget = { kind: TrashKind; item: TrashItem };

const emptyTrash: TrashData = { sections: [], posts: [], comments: [] };
const groups = [
  { key: "sections", label: "섹션", icon: Folder },
  { key: "posts", label: "게시물", icon: FileText },
  { key: "comments", label: "댓글", icon: MessageCircle },
] as const;

type PadTrashProps = { boardId: string; open: boolean };

function targetKey(kind: TrashKind, itemId: string) {
  return `${kind}:${itemId}`;
}

function itemLabel(item: TrashItem) {
  return item.title || item.originalName || item.body || "제목 없는 항목";
}

export function PadTrash({ boardId, open }: PadTrashProps) {
  const confirm = useConfirm();
  const [data, setData] = useState<TrashData>(emptyTrash);
  const [loading, setLoading] = useState(false);
  const [pendingId, setPendingId] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [refreshKey, setRefreshKey] = useState(0);
  const [selecting, setSelecting] = useState(false);
  const [selectedKeys, setSelectedKeys] = useState<Set<string>>(() => new Set());
  const [purging, setPurging] = useState(false);

  useEffect(() => {
    if (!open) return;
    const controller = new AbortController();
    queueMicrotask(() => {
      if (!controller.signal.aborted) { setLoading(true); setError(""); }
    });
    fetch(`/api/boards/${boardId}/trash`, { cache: "no-store", signal: controller.signal })
      .then(async (response) => {
        const result = await response.json();
        if (!response.ok) throw new Error(result.error || "보관함을 불러오지 못했습니다.");
        const next = result as TrashData;
        const availableKeys = new Set(groups.flatMap((group) => next[group.key].map((item) => targetKey(group.key, item.id))));
        setData(next);
        setSelectedKeys((current) => new Set(Array.from(current).filter((key) => availableKeys.has(key))));
      })
      .catch((reason) => { if (!controller.signal.aborted) setError(reason instanceof Error ? reason.message : "보관함을 불러오지 못했습니다."); })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [boardId, open, refreshKey]);

  async function restore(kind: TrashKind, itemId: string) {
    setPendingId(itemId); setError("");
    try {
      const response = await fetch(`/api/${kind}/${itemId}/restore`, { method: "POST" });
      const result = await response.json();
      if (!response.ok) return setError(result.error);
      setRefreshKey((value) => value + 1);
    } finally { setPendingId(null); }
  }

  async function purgeTargets(targets: TrashTarget[]) {
    if (!targets.length) return;
    const label = targets.length > 1
      ? `선택한 ${targets.length}개 항목`
      : `'${itemLabel(targets[0].item)}'`;
    const confirmed = await confirm({
      title: targets.length > 1 ? `${targets.length}개 항목 영구 삭제` : `${groups.find((group) => group.key === targets[0].kind)?.label ?? "항목"} 영구 삭제`,
      description: `${label}이(가) 되돌릴 수 없이 영구 삭제됩니다.`,
      confirmLabel: "영구 삭제",
      danger: true,
    });
    if (!confirmed) return;
    setPurging(true); setError("");
    try {
      const response = await fetch(`/api/admin/boards/${boardId}/trash/purge`, {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ items: targets.map((target) => ({ kind: target.kind, id: target.item.id })) }),
      });
      const result = await response.json();
      if (!response.ok) { setError(result.error); return; }
      setSelectedKeys(new Set());
      setSelecting(false);
      if (result.fileCleanupFailed) setError(`항목은 삭제했지만 실제 파일 ${result.fileCleanupFailed}개를 정리하지 못했습니다.`);
      setRefreshKey((value) => value + 1);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "선택한 항목을 영구 삭제하지 못했습니다.");
    } finally { setPurging(false); }
  }

  function toggleTarget(kind: TrashKind, itemId: string) {
    const key = targetKey(kind, itemId);
    setSelectedKeys((current) => {
      const next = new Set(current);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  function closeSelection() {
    setSelecting(false);
    setSelectedKeys(new Set());
  }

  if (loading) return <p className="trash-empty"><ArchiveRestore className="spin" size={20} />보관함을 확인하는 중입니다…</p>;
  const total = groups.reduce((sum, group) => sum + data[group.key].length, 0);
  if (!total) return <div>{error && <p className="form-error">{error}</p>}<p className="trash-empty"><ArchiveRestore size={22} />복구할 항목이 없습니다.</p></div>;
  const allTargets = groups.flatMap((group) => data[group.key].map((item) => ({ kind: group.key, item })));
  const selectedTargets = allTargets.filter((target) => selectedKeys.has(targetKey(target.kind, target.item.id)));
  const allSelected = selectedTargets.length === total;

  return (
    <div className="pad-trash">
      {error && <p className="form-error">{error}</p>}
      <div className={`trash-bulk-bar ${selecting ? "selecting" : ""}`}>
        {selecting ? (
          <>
            <span><b>{selectedTargets.length}</b>개 선택</span>
            <button
              type="button"
              onClick={() => setSelectedKeys(allSelected ? new Set() : new Set(allTargets.map((target) => targetKey(target.kind, target.item.id))))}
              disabled={purging}
            >
              <Check size={14} />{allSelected ? "전체 해제" : "전체 선택"}
            </button>
            <button type="button" onClick={closeSelection} disabled={purging}><X size={14} />취소</button>
            <button type="button" className="danger" onClick={() => purgeTargets(selectedTargets)} disabled={!selectedTargets.length || purging}><Trash2 size={14} />선택 영구 삭제</button>
          </>
        ) : (
          <>
            <span><ListChecks size={15} /><b>{total}</b>개 항목</span>
            <button type="button" onClick={() => setSelecting(true)}><ListChecks size={14} />여러 항목 선택</button>
          </>
        )}
      </div>
      {groups.map((group) => {
        const items = data[group.key];
        if (!items.length) return null;
        const Icon = group.icon;
        return (
          <section key={group.key}>
            <header><Icon size={15} /><h3>{group.label}</h3><span>{items.length}</span></header>
            <div>{items.map((item) => (
              <article key={item.id} className={selectedKeys.has(targetKey(group.key, item.id)) ? "selected" : ""}>
                {selecting && (
                  <label className="trash-select">
                    <input type="checkbox" checked={selectedKeys.has(targetKey(group.key, item.id))} onChange={() => toggleTarget(group.key, item.id)} aria-label={`${itemLabel(item)} 선택`} />
                    <span aria-hidden><Check size={13} /></span>
                  </label>
                )}
                <span><b>{itemLabel(item)}</b><small>{new Date(item.deletedAt).toLocaleString("ko-KR", { timeZone: "Asia/Seoul" })}</small></span>
                {!selecting && (
                  <div className="trash-item-actions">
                    {item.restorable && <button type="button" onClick={() => restore(group.key, item.id)} disabled={pendingId === item.id}><RotateCcw size={13} />복구</button>}
                    <button type="button" className="danger" onClick={() => purgeTargets([{ kind: group.key, item }])} disabled={purging}><Trash2 size={13} />영구 삭제</button>
                  </div>
                )}
              </article>
            ))}</div>
          </section>
        );
      })}
      <p className="trash-note">삭제한 섹션·게시물·댓글은 7일 안에 복구할 수 있습니다. 첨부파일은 삭제 즉시 영구 삭제됩니다.</p>
    </div>
  );
}
