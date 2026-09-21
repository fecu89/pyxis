"use client";

import { useCallback, useState } from "react";
import { LoaderCircle, Save } from "lucide-react";
import { InlineNotice } from "@/components/ui/feedback";
import { PagedSelectableList, type SelectableListPage } from "@/components/ui/selectable-list";
import type { CourseResourceItem, ResourceFilter } from "@/lib/subjects/resources";

async function readJson(response: Response) {
  const data = await response.json().catch(() => ({})) as Record<string, unknown>;
  if (!response.ok) throw new Error(typeof data.error === "string" ? data.error : "요청을 처리하지 못했습니다.");
  return data;
}

/**
 * 퀴즈·패드를 교과목에 붙였다 떼는 화면입니다. 저장은 화면에 보이는 목록 전체가 아니라
 * **바뀐 것만**(붙인 것 / 뗀 것) 보냅니다 — 목록이 페이지로 나뉘어 있어 "지금 체크된 전부"가
 * 곧 최종 상태일 수 없기 때문입니다.
 */
export function ResourcePanel({
  subjectId,
  kind,
  onChanged,
}: {
  subjectId: string;
  kind: "quiz" | "board" | "form";
  onChanged?: () => void;
}) {
  const label = kind === "quiz" ? "퀴즈" : kind === "form" ? "설문" : "패드";
  const [filter, setFilter] = useState<ResourceFilter>("all");
  const [added, setAdded] = useState<Set<string>>(new Set());
  const [removed, setRemoved] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);

  // 서버가 준 `linked`를 그대로 체크 상태로 쓰지 않고, "원래 붙어 있었나"를 페이지마다 모아
  // 델타로 환산합니다. 그래야 페이지를 넘겨도 앞 페이지에서 바꾼 것이 유지됩니다.
  const [linkedOnPage, setLinkedOnPage] = useState<Set<string>>(new Set());
  const loadTracked = useCallback(async (query: { search: string; page: number; signal: AbortSignal }): Promise<SelectableListPage> => {
    const searchQuery = new URLSearchParams({ type: kind, q: query.search, page: String(query.page), filter });
    const data = await readJson(await fetch(`/api/subjects/${subjectId}/candidates?${searchQuery}`, { cache: "no-store", signal: query.signal })) as unknown as {
      items: CourseResourceItem[]; totalCount: number; page: number; pageSize: number;
    };
    setLinkedOnPage((current) => {
      const next = new Set(current);
      for (const item of data.items) { if (item.linked) next.add(item.id); else next.delete(item.id); }
      return next;
    });
    return {
      items: data.items.map((item) => ({
        id: item.id,
        title: item.title,
        meta: item.otherCourseName ? `현재 '${item.otherCourseName}' 소속 — 옮겨집니다` : null,
      })),
      totalCount: data.totalCount,
      page: data.page,
      pageSize: data.pageSize,
    };
  }, [subjectId, kind, filter]);

  const selected = new Set<string>([...linkedOnPage, ...added].filter((id) => !removed.has(id)));
  const dirty = added.size > 0 || removed.size > 0;

  function toggle(id: string, next: boolean) {
    const wasLinked = linkedOnPage.has(id);
    setAdded((current) => {
      const copy = new Set(current);
      if (next && !wasLinked) copy.add(id); else copy.delete(id);
      return copy;
    });
    setRemoved((current) => {
      const copy = new Set(current);
      if (!next && wasLinked) copy.add(id); else copy.delete(id);
      return copy;
    });
  }

  async function save() {
    if (!dirty || busy) return;
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const key = kind === "quiz" ? "quizzes" : kind === "form" ? "forms" : "boards";
      await readJson(await fetch(`/api/subjects/${subjectId}/resources`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ [key]: { add: [...added], remove: [...removed] } }),
      }));
      setNotice(`${label} 연결을 저장했습니다.`);
      setAdded(new Set());
      setRemoved(new Set());
      setReloadKey((value) => value + 1);
      onChanged?.();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "저장하지 못했습니다.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="course-resource">
      {error ? <InlineNotice tone="error">{error}</InlineNotice> : null}
      {notice ? <InlineNotice tone="success">{notice}</InlineNotice> : null}
      <PagedSelectableList
        title={`${label} 연결`}
        description={`체크한 ${label}가 이 교과목에 속합니다. 다른 교과목 소속을 고르면 이쪽으로 옮겨집니다.`}
        emptyLabel={`조건에 맞는 ${label}가 없습니다.`}
        searchPlaceholder={`${label} 제목 검색`}
        unitLabel={label}
        load={loadTracked}
        selected={selected}
        onSelectionChange={(_next, changed) => { for (const item of changed) toggle(item.id, item.selected); }}
        reloadKey={reloadKey}
        busy={busy}
        filters={
          <label className="select-filter">
            <span className="sr-only">범위</span>
            <select value={filter} onChange={(event) => setFilter(event.target.value as ResourceFilter)}>
              <option value="all">전체</option>
              <option value="linked">이 교과목</option>
              <option value="unassigned">미분류</option>
            </select>
          </label>
        }
      />
      <div className="course-picker-apply">
        <button type="button" className="button primary" disabled={!dirty || busy} onClick={() => void save()}>
          {busy ? <LoaderCircle size={15} className="spin" /> : <Save size={15} />}
          {dirty ? `변경 ${added.size + removed.size}건 저장` : "변경 없음"}
        </button>
      </div>
    </div>
  );
}
