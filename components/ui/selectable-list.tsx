"use client";

import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { Check, ChevronLeft, ChevronRight, LoaderCircle, Search } from "lucide-react";

/**
 * "행 전체를 클릭해서 고르는" 선택 목록의 공용 프리미티브입니다. admin 사용자 목록
 * (components/admin/user-card.tsx · admin-users-panel.tsx)에서 쓰던 패턴 — 행 클릭 토글 + shift
 * 범위 선택 + 툴바 일괄 선택 + sr-only 체크박스 — 을 다른 화면에서도 그대로 쓸 수 있게 뽑아
 * 냈습니다. 동작 규칙은 admin과 한 글자도 다르지 않게 옮겼고, 색만 app/globals.css의
 * .select-* 클래스(브랜드 토큰 파생)로 옮겨 담았습니다.
 *
 * `SelectableList`는 이미 메모리에 있는 `items` 배열 하나만 그리는 순수 프리미티브입니다.
 * 패널 테두리·헤더·검색창은 그리지 않으므로, 이미 자기만의 박스가 있는 화면(예: 교과목의
 * "학급 연결하기" 후보 목록)에 그대로 끼워 넣을 수 있습니다. 검색·페이지네이션까지 필요하면
 * 아래 `PagedSelectableList`를 씁니다 — 내부적으로 이 컴포넌트를 그대로 재사용합니다.
 */

export type SelectableItem = {
  id: string;
  title: string;
  meta?: string | null;
  badge?: ReactNode;
  disabled?: boolean;
};

type SelectionChange = { id: string; selected: boolean };
type OnSelectionChange = (next: Set<string>, changed: SelectionChange[]) => void;

export function SelectableList({
  items,
  selected,
  onSelectionChange,
  busy = false,
  toolbar = true,
  toolbarActions,
  selectionMode = "multiple",
  unitLabel,
  unitSuffix = "개",
  emptyLabel,
  ariaLabel,
}: {
  items: SelectableItem[];
  selected: Set<string>;
  onSelectionChange: OnSelectionChange;
  busy?: boolean;
  /** 기본 true. 목록 위 "N개 선택됨 / 전체선택 / 전체 해제" 줄을 숨기고 싶을 때만 false로.
   * selectionMode가 "single"이면 이 값과 무관하게 항상 숨긴다(전체선택이 의미가 없으므로). */
  toolbar?: boolean;
  /** 선택 화면만의 명령을 공용 전체선택·해제 버튼 앞에 둡니다. */
  toolbarActions?: ReactNode;
  /** 기본 "multiple"(체크박스 다중 선택 + shift 범위 선택 + 툴바). "single"을 주면 행을
   * 클릭할 때마다 그 행 하나로 선택을 통째로 교체하고, 이미 선택된 행을 다시 클릭하면
   * 해제한다(예: 공유 대화상자의 "링크 하나만 고르기"). shift 클릭도 범위 선택 없이 그냥
   * 클릭으로 처리하고 앵커(anchorRef)는 쓰지 않으며, 툴바는 toolbar prop과 무관하게 그리지
   * 않는다. */
  selectionMode?: "multiple" | "single";
  unitLabel: string;
  /** 세는 단위. 사물은 기본 "개", 사람 목록이면 "명"으로 넘긴다("학생 5명 선택됨"). */
  unitSuffix?: string;
  emptyLabel: string;
  ariaLabel: string;
}): ReactNode {
  // 마지막으로 "일반 클릭"한 행의 인덱스 — shift 범위 선택의 기준점입니다
  // (admin-users-panel.tsx의 selectionAnchor와 같은 역할). 렌더링에 영향을 주지 않는 순수 UI
  // 상태라 ref로 둡니다. items 자체가 바뀌면(페이지 이동·재검색으로 목록이 통째로 갈리면)
  // 기준점이 더는 의미가 없으므로 리셋합니다.
  const anchorRef = useRef<number | null>(null);
  useEffect(() => {
    anchorRef.current = null;
  }, [items]);

  function handleRowMouseDown(event: React.MouseEvent) {
    if (event.shiftKey) event.preventDefault();
  }

  function toggleOne(item: SelectableItem) {
    if (item.disabled || busy) return;
    const nextSelected = !selected.has(item.id);
    const next = new Set(selected);
    if (nextSelected) next.add(item.id); else next.delete(item.id);
    onSelectionChange(next, [{ id: item.id, selected: nextSelected }]);
  }

  // selectionMode="single" 전용: 클릭한 행 하나로 선택을 통째로 교체합니다. 이미 선택된
  // 행이면 해제합니다(빈 선택도 유효한 상태). 그래서 아래 sr-only 입력은 radio가 아니라
  // checkbox를 그대로 씁니다 — radio 그룹은 표준적으로 "전부 해제"를 지원하지 않아 이 해제
  // 동작과 맞지 않습니다.
  function selectOnly(item: SelectableItem) {
    if (item.disabled || busy) return;
    if (selected.has(item.id)) {
      const next = new Set(selected);
      next.delete(item.id);
      onSelectionChange(next, [{ id: item.id, selected: false }]);
      return;
    }
    const next = new Set([item.id]);
    const changed: SelectionChange[] = [];
    for (const id of selected) changed.push({ id, selected: false });
    changed.push({ id: item.id, selected: true });
    onSelectionChange(next, changed);
  }

  // 행 클릭과 sr-only 체크박스 조작을 selectionMode에 맞게 분기하는 공통 진입점입니다.
  function applyRowSelection(item: SelectableItem) {
    if (selectionMode === "single") selectOnly(item);
    else toggleOne(item);
  }

  // 행을 클릭해 선택합니다. Shift는 기준점부터 이번 행까지 범위를 선택에 "더합니다"
  // (admin-users-panel.tsx의 selectRow와 동일한 동작 — 파인더·지메일과 같은 방식이라 범위 안에
  // 이미 선택된 항목을 다시 빼지 않습니다). 기준점은 일반 클릭에서만 옮기고 shift 클릭
  // 자체는 옮기지 않습니다. selectionMode="single"이면 범위 선택 자체가 의미 없으므로 shift도
  // 그냥 클릭으로 처리하고 앵커는 건드리지 않습니다.
  function selectRow(item: SelectableItem, index: number, event: { shiftKey: boolean }) {
    if (item.disabled || busy) return;
    if (selectionMode === "multiple" && event.shiftKey && anchorRef.current !== null) {
      const anchor = anchorRef.current;
      const [start, end] = anchor < index ? [anchor, index] : [index, anchor];
      const next = new Set(selected);
      const changed: SelectionChange[] = [];
      for (const entry of items.slice(start, end + 1)) {
        if (entry.disabled || next.has(entry.id)) continue;
        next.add(entry.id);
        changed.push({ id: entry.id, selected: true });
      }
      if (changed.length) onSelectionChange(next, changed);
      return;
    }
    applyRowSelection(item);
    if (selectionMode === "multiple") anchorRef.current = index;
  }

  function handleRowClick(event: React.MouseEvent, item: SelectableItem, index: number) {
    // 버튼·링크·입력 요소를 누른 클릭은 행 선택으로 이어지지 않습니다(그 요소 자신의 동작이
    // 우선입니다). admin-user-card.tsx의 handleCardClick과 동일한 가드입니다.
    if (event.target instanceof Element && event.target.closest("button, a, input")) return;
    selectRow(item, index, { shiftKey: event.shiftKey });
  }

  const selectableIds = items.filter((item) => !item.disabled).map((item) => item.id);
  const allVisibleSelected = selectableIds.length > 0 && selectableIds.every((id) => selected.has(id));

  // admin 사용자 목록의 "전체선택"은 한 페이지에 대상 전체가 다 있어서 선택 Set을 통째로
  // 바꿔도(교체) 됩니다. 이 컴포넌트는 페이지네이션과 함께 쓰이는 경우가 있어 한 화면엔
  // 일부만 있고, "전체선택" 후 다음 페이지로 넘어가 계속 고를 수 있어야 하므로 기존 선택을
  // 지우지 않고 지금 보이는 항목만 기존 selected에 "합집합"으로 더합니다.
  function selectAllVisible() {
    if (busy || !selectableIds.length || allVisibleSelected) return;
    const next = new Set(selected);
    const changed: SelectionChange[] = [];
    for (const id of selectableIds) {
      if (next.has(id)) continue;
      next.add(id);
      changed.push({ id, selected: true });
    }
    anchorRef.current = null;
    if (changed.length) onSelectionChange(next, changed);
  }

  // "전체 해제"도 전체선택과 대칭으로 **지금 보이는 항목만** 해제합니다. selected에는 화면
  // 밖 항목이 섞여 있을 수 있는데(예: 리소스 패널에서 다른 페이지의 "원래 연결돼 있던" 항목),
  // 보이지 않는 것까지 한 번에 비우면 사용자가 인지하지 못한 대량 해제가 예약되기 때문입니다.
  const anyVisibleSelected = items.some((item) => selected.has(item.id));
  function deselectVisible() {
    if (busy || !anyVisibleSelected) return;
    const next = new Set(selected);
    const changed: SelectionChange[] = [];
    for (const item of items) {
      if (!next.has(item.id)) continue;
      next.delete(item.id);
      changed.push({ id: item.id, selected: false });
    }
    anchorRef.current = null;
    if (changed.length) onSelectionChange(next, changed);
  }

  return (
    <>
      {toolbar && selectionMode === "multiple" && (
        <div className="select-toolbar">
          <span>{selected.size > 0 ? `${unitLabel} ${selected.size}${unitSuffix} 선택됨` : `${items.length}${unitSuffix} 표시 중`}</span>
          <div className="select-toolbar-actions">
            {toolbarActions}
            <button type="button" className="select-toolbar-button" onClick={selectAllVisible} disabled={busy || !selectableIds.length || allVisibleSelected}>전체선택</button>
            <button type="button" className="select-toolbar-button" onClick={deselectVisible} disabled={busy || !anyVisibleSelected}>전체 해제</button>
          </div>
        </div>
      )}
      {items.length === 0 ? (
        <p className="select-empty">{emptyLabel}</p>
      ) : (
        <ul className="select-list" aria-label={ariaLabel}>
          {items.map((item, index) => {
            const isSelected = selected.has(item.id);
            return (
              <li key={item.id}>
                <div
                  className="select-row"
                  data-selected={isSelected}
                  data-disabled={Boolean(item.disabled)}
                  onClick={(event) => handleRowClick(event, item, index)}
                  onMouseDown={handleRowMouseDown}
                >
                  <input
                    type="checkbox"
                    className="sr-only"
                    checked={isSelected}
                    disabled={item.disabled || busy}
                    onChange={() => applyRowSelection(item)}
                    aria-label={`${item.title || "항목"} 선택`}
                  />
                  <span className="select-row-avatar" data-selected={isSelected} aria-hidden>
                    {isSelected ? <Check size={15} /> : (item.title || "?")[0]}
                  </span>
                  <span className="select-row-copy">
                    <b>{item.title}</b>
                    {item.meta ? <small title={item.meta}>{item.meta}</small> : null}
                  </span>
                  {item.badge}
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </>
  );
}

export type SelectableListPage = {
  items: SelectableItem[];
  totalCount: number;
  page: number;
  pageSize: number;
  /** 검색 대상이 너무 넓어 일부만 훑었을 때. 사용자에게 더 좁히라고 알립니다. */
  truncated?: boolean;
};

export function PagedSelectableList({
  title,
  description,
  emptyLabel,
  searchPlaceholder,
  unitLabel,
  unitSuffix,
  load,
  selected,
  onSelectionChange,
  filters,
  reloadKey = 0,
  busy = false,
  deferLoad = false,
  ready = false,
  idleLabel,
}: {
  title: string;
  description?: string;
  emptyLabel: string;
  searchPlaceholder: string;
  unitLabel: string;
  /** 세는 단위. SelectableList와 동일 — 사람 목록이면 "명". */
  unitSuffix?: string;
  load: (query: { search: string; page: number; signal: AbortSignal }) => Promise<SelectableListPage>;
  selected: Set<string>;
  onSelectionChange: OnSelectionChange;
  filters?: ReactNode;
  /** 바깥에서 저장이 끝났을 때 이 값을 바꾸면 현재 페이지를 다시 읽습니다. */
  reloadKey?: number;
  busy?: boolean;
  /** true면 ready가 되거나 검색어가 들어오기 전까지는 서버를 부르지 않습니다. */
  deferLoad?: boolean;
  ready?: boolean;
  idleLabel?: string;
}): ReactNode {
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const [data, setData] = useState<SelectableListPage | null>(null);
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  // 응답이 보낸 순서가 아니라 도착한 순서로 반영되면 오래된 검색 결과가 최신을 덮어씁니다.
  const seq = useRef(0);

  // load의 정체성이 바뀌면(예: 학급·범위 필터 변경) 이전 조건으로 받은 목록과 페이지 번호는
  // 더는 유효하지 않습니다. effect에서 지우면 새 목록이 오기 전 한동안 옛 목록이 그대로
  // 보이고 클릭까지 되므로, 렌더 중 상태 조정 패턴으로 즉시 버립니다.
  const [prevLoad, setPrevLoad] = useState(() => load);
  if (prevLoad !== load) {
    setPrevLoad(() => load);
    setPage(1);
    setData(null);
    setLoadError(null);
  }

  // deferLoad가 걸린 화면(예: 학급을 먼저 골라야 검색이 되는 학생 후보)은 검색어도 없고
  // 아직 ready도 아니면 굳이 서버를 부르지 않습니다 — 다만 검색어를 입력하면 ready 여부와
  // 무관하게 바로 찾아줍니다(사용자 확정 사항).
  const idle = deferLoad && !ready && search.trim() === "";

  const run = useCallback(async (nextSearch: string, nextPage: number, signal: AbortSignal) => {
    const mine = ++seq.current;
    setLoading(true);
    try {
      const result = await load({ search: nextSearch, page: nextPage, signal });
      if (mine !== seq.current) return;
      setData(result);
      setLoadError(null);
    } catch (cause) {
      if (signal.aborted) return;
      // 실패를 삼키면 data가 null인 채 "불러오는 중…"이 영영 남습니다. 검색어·페이지·필터를
      // 바꾸면 다시 시도됩니다.
      if (mine === seq.current) setLoadError(cause instanceof Error ? cause.message : "목록을 불러오지 못했습니다.");
    } finally {
      if (mine === seq.current) setLoading(false);
    }
  }, [load]);

  // 타이핑마다 요청하지 않도록 250ms 묶습니다. idle 상태에서는 아예 예약하지 않습니다.
  // (react-hooks/set-state-in-effect 때문에 여기서 곧바로 setData(null)을 부르지 않습니다 —
  // 대신 seq만 미리 무효화해서 그 직전에 날아간 요청이 뒤늦게 돌아와도 반영되지 않게 막고,
  // 아래 렌더링에서 idle이면 data를 아예 쳐다보지 않는 것으로 "리셋"과 같은 효과를 냅니다.)
  useEffect(() => {
    if (idle) {
      seq.current += 1;
      return;
    }
    const controller = new AbortController();
    const timer = window.setTimeout(() => void run(search, page, controller.signal), 250);
    return () => {
      window.clearTimeout(timer);
      controller.abort();
      // 조건이 바뀌어 이 effect가 물러날 때 진행 중이던 요청도 무효화합니다 — 안 하면 새
      // 요청이 예약되기 전 도착한 옛 응답이 방금 리셋한 화면을 되살립니다.
      seq.current += 1;
    };
  }, [idle, search, page, run, reloadKey]);

  const totalPages = data ? Math.max(1, Math.ceil(data.totalCount / data.pageSize)) : 1;

  return (
    <section className="select-panel">
      <header className="select-head">
        <div>
          <b>{title}</b>
          {description ? <small>{description}</small> : null}
        </div>
      </header>

      <div className="select-controls">
        <label className="select-search">
          <Search size={15} aria-hidden />
          <span className="sr-only">{searchPlaceholder}</span>
          <input
            value={search}
            placeholder={searchPlaceholder}
            onChange={(event) => { setSearch(event.target.value); setPage(1); }}
          />
          {!idle && loading ? <LoaderCircle size={14} className="spin" aria-hidden /> : null}
        </label>
        {filters}
      </div>

      {idle ? (
        <p className="select-idle">{idleLabel ?? "검색어를 입력해 주세요."}</p>
      ) : loadError ? (
        <p className="select-empty">{loadError}</p>
      ) : !data ? (
        <p className="select-empty"><LoaderCircle size={14} className="spin" aria-hidden /> 불러오는 중…</p>
      ) : (
        <>
          {data.truncated ? (
            <p className="select-notice">찾을 대상이 너무 많아 일부만 확인했습니다. 검색어를 더 자세히 입력하거나 필터로 좁혀 주세요.</p>
          ) : null}

          <SelectableList
            items={data.items}
            selected={selected}
            onSelectionChange={onSelectionChange}
            busy={busy || loading}
            unitLabel={unitLabel}
            unitSuffix={unitSuffix}
            emptyLabel={emptyLabel}
            ariaLabel={title}
          />

          {totalPages > 1 ? (
            <nav className="select-pager" aria-label={`${title} 페이지`}>
              <button type="button" className="icon-button small" onClick={() => setPage((value) => Math.max(1, value - 1))} disabled={page <= 1} aria-label="이전 페이지">
                <ChevronLeft size={15} />
              </button>
              <span>{page} / {totalPages}</span>
              <button type="button" className="icon-button small" onClick={() => setPage((value) => Math.min(totalPages, value + 1))} disabled={page >= totalPages} aria-label="다음 페이지">
                <ChevronRight size={15} />
              </button>
            </nav>
          ) : null}
        </>
      )}
    </section>
  );
}
