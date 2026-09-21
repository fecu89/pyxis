"use client";

import { useEffect, useState } from "react";
import { Building2, LoaderCircle, UsersRound } from "lucide-react";
import { requestJson } from "@/lib/api-client";
import styles from "@/components/pad/settings/settings.module.css";

type Group = { id: string; name: string; type: "CLASS" | "DEPARTMENT"; memberCount: number };

const typeLabel: Record<Group["type"], string> = { CLASS: "학급", DEPARTMENT: "부서" };

// 검색 피커(member-invite-picker.tsx)는 한 명씩 찾아 추가합니다. 이건 그 그룹(반) 단위
// 버전입니다 — 교사가 학생 20~30명을 한 명씩 누르지 않고 학급·부서를 통째로 추가합니다.
export function MemberGroupInvite({ boardId, onInvited }: { boardId: string; onInvited: () => void | Promise<void> }) {
  const [groups, setGroups] = useState<Group[]>([]);
  const [selectedId, setSelectedId] = useState("");
  const [note, setNote] = useState("");
  const [loading, setLoading] = useState(true);
  const [adding, setAdding] = useState(false);
  const [error, setError] = useState("");
  const [result, setResult] = useState("");

  useEffect(() => {
    const controller = new AbortController();
    fetch(`/api/boards/${boardId}/members/groups`, { signal: controller.signal })
      .then((response) => response.json())
      .then((data) => {
        if (controller.signal.aborted) return;
        setGroups(data.groups ?? []);
        setNote(data.note ?? "");
        setSelectedId(data.groups?.[0]?.id ?? "");
      })
      .catch(() => { if (!controller.signal.aborted) setError("학급·부서 목록을 불러오지 못했습니다."); })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [boardId]);

  async function addGroup() {
    const group = groups.find((item) => item.id === selectedId);
    if (!group) return;
    setAdding(true);
    setError("");
    setResult("");
    try {
      const response = await requestJson<{ addedCount: number; skippedCount: number }>(`/api/boards/${boardId}/members/groups`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ schoolGroupId: group.id }),
      });
      setResult(response.skippedCount > 0
        ? `${response.addedCount}명 추가됨(이미 멤버인 ${response.skippedCount}명은 건너뜀)`
        : `${response.addedCount}명 추가됨`);
      await onInvited();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "학급·부서 멤버를 추가하지 못했습니다.");
    } finally {
      setAdding(false);
    }
  }

  if (loading) return <p className={styles.note}><LoaderCircle size={13} className="spin" />학급·부서를 찾는 중…</p>;
  if (note) return <p className={styles.note}>{note}</p>;
  if (!groups.length) return <p className={styles.note}>추가할 수 있는 학급·부서가 없어요.</p>;

  const selected = groups.find((item) => item.id === selectedId);

  return (
    <div className={styles.inviteBox}>
      <div className={styles.statusRow}>
        <span>
          <Building2 size={14} />
          {groups.length > 1 ? (
            <select value={selectedId} onChange={(event) => setSelectedId(event.target.value)} disabled={adding}>
              {(["CLASS", "DEPARTMENT"] as const).map((type) => {
                const items = groups.filter((group) => group.type === type);
                if (!items.length) return null;
                return (
                  <optgroup key={type} label={typeLabel[type]}>
                    {items.map((group) => <option key={group.id} value={group.id}>{group.name} ({group.memberCount}명)</option>)}
                  </optgroup>
                );
              })}
            </select>
          ) : (
            <>{selected?.name}<small>{typeLabel[selected!.type]} · {selected?.memberCount}명</small></>
          )}
        </span>
        <button type="button" className="button soft small" disabled={adding || !selected} onClick={addGroup}>
          {adding ? <LoaderCircle size={13} className="spin" /> : <UsersRound size={13} />}
          {groups.length > 1 ? "전체 추가" : "우리 반 전체 추가"}
        </button>
      </div>
      {error && <p className="form-error compact">{error}</p>}
      {result && <p className={styles.note}>{result}</p>}
    </div>
  );
}
