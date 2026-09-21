"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { ExternalLink } from "lucide-react";
import { AdminPagination } from "@/components/admin/shared/admin-pagination";
import { ADMIN_ROLE_LABELS } from "@/components/admin/shared/labels";
import { resourceManagerQuery, type ResourceManagerFilters } from "@/components/admin/resources/resource-manager-query";
import { AdminSortableHeader, ResourceManagerFilters as ResourceManagerFiltersView } from "@/components/admin/resources/resource-manager-ui";
import type { AdminBoardRecord } from "@/components/admin/types";
import { requestJson } from "@/lib/api-client";

const scopeLabels = { PRIVATE: "비공개", LINK: "링크", PUBLIC: "공개" } as const;

type SortBy = "title" | "updatedAt" | "sections" | "posts";
type BoardFilters = ResourceManagerFilters<SortBy>;

export function BoardManager({ initialBoards, initialTotalCount, initialPage, initialPageSize }: {
  initialBoards: AdminBoardRecord[];
  initialTotalCount: number;
  initialPage: number;
  initialPageSize: number;
}) {
  const [boards, setBoards] = useState(initialBoards);
  const [totalCount, setTotalCount] = useState(initialTotalCount);
  const [page, setPage] = useState(initialPage);
  const [pageSize, setPageSize] = useState(initialPageSize);
  const [search, setSearch] = useState("");
  const [ownerAccount, setOwnerAccount] = useState("");
  const [updatedFrom, setUpdatedFrom] = useState("");
  const [updatedTo, setUpdatedTo] = useState("");
  const [includeArchived, setIncludeArchived] = useState(false);
  const [sortBy, setSortBy] = useState<SortBy>("updatedAt");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const loadControllerRef = useRef<AbortController | null>(null);
  useEffect(() => () => loadControllerRef.current?.abort(), []);

  async function load(targetPage: number, targetPageSize: number, overrides: Partial<BoardFilters> = {}) {
    loadControllerRef.current?.abort();
    const controller = new AbortController();
    loadControllerRef.current = controller;
    setPending(true);
    setError("");
    try {
      const filters: BoardFilters = {
        search: overrides.search ?? search,
        ownerAccount: overrides.ownerAccount ?? ownerAccount,
        updatedFrom: overrides.updatedFrom ?? updatedFrom,
        updatedTo: overrides.updatedTo ?? updatedTo,
        includeArchived: overrides.includeArchived ?? includeArchived,
        sortBy: overrides.sortBy ?? sortBy,
        sortDir: overrides.sortDir ?? sortDir,
      };
      const query = resourceManagerQuery(targetPage, targetPageSize, filters);
      const result = await requestJson<{ boards: AdminBoardRecord[]; totalCount: number; page: number; pageSize: number }>(`/api/admin/boards?${query}`, { cache: "no-store", signal: controller.signal });
      setBoards(result.boards);
      setTotalCount(result.totalCount);
      setPage(result.page);
      setPageSize(result.pageSize);
    } catch (reason) {
      if (reason instanceof DOMException && reason.name === "AbortError") return;
      setError(reason instanceof Error ? reason.message : "패드 목록을 불러오지 못했습니다.");
    } finally {
      if (loadControllerRef.current === controller) {
        loadControllerRef.current = null;
        setPending(false);
      }
    }
  }

  // 제목·소유자 검색 모두 2글자 이상 입력하고 200ms 멈추면 자동 검색합니다. 소유자는 이름이
  // 아니라 로그인 아이디·카카오 이메일 정확 검색이라(아래 검색창 참고) 완성되기 전까지는
  // 계속 "결과 없음"이 나올 수 있지만, 그래도 매번 버튼을 누르지 않아도 되게 자동 검색으로
  // 통일했습니다. 첫 렌더에는 실행하지 않습니다.
  const skipNextSearchEffect = useRef(true);
  useEffect(() => {
    if (skipNextSearchEffect.current) { skipNextSearchEffect.current = false; return; }
    const trimmedSearch = search.trim();
    const trimmedOwner = ownerAccount.trim();
    if (trimmedSearch.length === 1 || trimmedOwner.length === 1) return;
    const timer = setTimeout(() => { void load(1, pageSize, { search: trimmedSearch, ownerAccount: trimmedOwner }); }, 200);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search, ownerAccount]);

  function submitSearch() {
    void load(1, pageSize, {});
  }

  function changeUpdatedFrom(value: string) {
    setUpdatedFrom(value);
    void load(1, pageSize, { updatedFrom: value });
  }

  function changeUpdatedTo(value: string) {
    setUpdatedTo(value);
    void load(1, pageSize, { updatedTo: value });
  }

  function toggleIncludeArchived() {
    const next = !includeArchived;
    setIncludeArchived(next);
    void load(1, pageSize, { includeArchived: next });
  }

  function changePageSize(nextPageSize: number) {
    void load(1, nextPageSize, {});
  }

  // 보관함 보기에서는 서버가 항상 보관일 기준으로 정렬하므로(getAdminBoardPage), 제목·섹션·글
  // 정렬 버튼은 비활성화하고 날짜 열만 정렬 방향을 바꿀 수 있게 합니다.
  function changeSort(column: SortBy) {
    if (includeArchived && column !== "updatedAt") return;
    const nextDir = sortBy === column && sortDir === "asc" ? "desc" : "asc";
    setSortBy(column);
    setSortDir(nextDir);
    void load(1, pageSize, { sortBy: column, sortDir: nextDir });
  }

  return (
    <section className="admin-panel board-manager" role="tabpanel">
      <header className="admin-panel-header">
        <div><span className="admin-kicker">ALL BOARDS</span><h2>전체 패드</h2><p>플랫폼에 있는 모든 패드를 소유자와 무관하게 훑어봅니다. 열기·보관 관리는 각 패드 설정에서 합니다.</p></div>
      </header>
      <ResourceManagerFiltersView resourceLabel="패드" searchId="board-search" search={search} ownerAccount={ownerAccount} updatedFrom={updatedFrom} updatedTo={updatedTo} includeArchived={includeArchived} totalCount={totalCount} pending={pending} onSubmit={submitSearch} onSearchChange={setSearch} onOwnerAccountChange={setOwnerAccount} onUpdatedFromChange={changeUpdatedFrom} onUpdatedToChange={changeUpdatedTo} onIncludeArchivedChange={toggleIncludeArchived} />
      {error ? <p className="admin-global-error" role="alert">{error}</p> : null}
      <div className="admin-table-wrap">
        <table className="admin-user-table admin-sortable-table">
          <thead>
            <tr>
              <AdminSortableHeader column="title" label="패드" sortBy={sortBy} sortDir={sortDir} disabled={includeArchived} onSort={changeSort} />
              <th>소유자</th>
              <th>공개 범위</th>
              <AdminSortableHeader column="sections" label="섹션" sortBy={sortBy} sortDir={sortDir} disabled={includeArchived} onSort={changeSort} />
              <AdminSortableHeader column="posts" label="글" sortBy={sortBy} sortDir={sortDir} disabled={includeArchived} onSort={changeSort} />
              <AdminSortableHeader column="updatedAt" label={includeArchived ? "보관일" : "수정일"} sortBy={sortBy} sortDir={sortDir} onSort={changeSort} />
              <th><span className="sr-only">열기</span></th>
            </tr>
          </thead>
          <tbody>
            {boards.map((board) => (
              <tr key={board.id}>
                <td data-label="패드">{board.title}{board.isTemplate ? <em className="admin-manager-badge">템플릿</em> : null}</td>
                <td data-label="소유자">{board.owner.name || "이름 없음"} <small>{board.ownerRole ? ADMIN_ROLE_LABELS[board.ownerRole] : "승계 필요"}</small></td>
                <td data-label="공개 범위">{scopeLabels[board.discoveryScope]}</td>
                <td data-label="섹션">{board._count.sections}개</td>
                <td data-label="글">{board._count.posts}개</td>
                <td data-label="수정일">{new Date(board.deletedAt ?? board.updatedAt).toLocaleDateString("ko-KR", { timeZone: "Asia/Seoul" })}</td>
                <td data-label="열기"><Link href={`/b/${board.slug}`} prefetch={false} target="_blank" className="icon-button small" aria-label={`${board.title} 열기`}><ExternalLink size={14} /></Link></td>
              </tr>
            ))}
          </tbody>
        </table>
        {!boards.length && <p className="admin-empty">{search.trim() || ownerAccount.trim() ? "검색 조건에 맞는 패드가 없습니다." : "패드가 없습니다."}</p>}
      </div>
      <AdminPagination page={page} pageSize={pageSize} totalCount={totalCount} pending={pending} onPageChange={(nextPage) => void load(nextPage, pageSize)} onPageSizeChange={changePageSize} />
    </section>
  );
}
