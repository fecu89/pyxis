"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { ExternalLink } from "lucide-react";
import { resourceManagerQuery, type ResourceManagerFilters } from "@/components/admin/resources/resource-manager-query";
import { AdminSortableHeader, ResourceManagerFilters as ResourceManagerFiltersView } from "@/components/admin/resources/resource-manager-ui";
import { AdminPagination } from "@/components/admin/shared/admin-pagination";
import { ADMIN_ROLE_LABELS } from "@/components/admin/shared/labels";
import type { AdminFormRecord } from "@/components/admin/types";
import { requestJson } from "@/lib/api-client";

const statusLabels = { DRAFT: "임시저장", OPEN: "응답 받는 중", CLOSED: "마감" } as const;

type SortBy = "title" | "updatedAt" | "fields" | "responses";
type FormFilters = ResourceManagerFilters<SortBy>;

export function FormManager({ initialForms, initialTotalCount, initialPage, initialPageSize }: {
  initialForms: AdminFormRecord[];
  initialTotalCount: number;
  initialPage: number;
  initialPageSize: number;
}) {
  const [forms, setForms] = useState(initialForms);
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

  async function load(targetPage: number, targetPageSize: number, overrides: Partial<FormFilters> = {}) {
    loadControllerRef.current?.abort();
    const controller = new AbortController();
    loadControllerRef.current = controller;
    setPending(true);
    setError("");
    try {
      const filters: FormFilters = {
        search: overrides.search ?? search,
        ownerAccount: overrides.ownerAccount ?? ownerAccount,
        updatedFrom: overrides.updatedFrom ?? updatedFrom,
        updatedTo: overrides.updatedTo ?? updatedTo,
        includeArchived: overrides.includeArchived ?? includeArchived,
        sortBy: overrides.sortBy ?? sortBy,
        sortDir: overrides.sortDir ?? sortDir,
      };
      const query = resourceManagerQuery(targetPage, targetPageSize, filters);
      const result = await requestJson<{ forms: AdminFormRecord[]; totalCount: number; page: number; pageSize: number }>(`/api/admin/forms?${query}`, { cache: "no-store", signal: controller.signal });
      setForms(result.forms);
      setTotalCount(result.totalCount);
      setPage(result.page);
      setPageSize(result.pageSize);
    } catch (reason) {
      if (reason instanceof DOMException && reason.name === "AbortError") return;
      setError(reason instanceof Error ? reason.message : "설문 목록을 불러오지 못했습니다.");
    } finally {
      if (loadControllerRef.current === controller) {
        loadControllerRef.current = null;
        setPending(false);
      }
    }
  }

  // 제목·소유자 검색 모두 2글자 이상 입력하고 200ms 멈추면 자동 검색합니다 — board-manager.tsx와 같은 이유입니다.
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

  // 보관함 보기에서는 서버가 항상 보관일 기준으로 정렬하므로(getAdminFormPage), 제목·필드·응답
  // 정렬 버튼은 비활성화하고 날짜 열만 정렬 방향을 바꿀 수 있게 합니다.
  function changeSort(column: SortBy) {
    if (includeArchived && column !== "updatedAt") return;
    const nextDir = sortBy === column && sortDir === "asc" ? "desc" : "asc";
    setSortBy(column);
    setSortDir(nextDir);
    void load(1, pageSize, { sortBy: column, sortDir: nextDir });
  }

  return (
    <section className="admin-panel form-manager" role="tabpanel">
      <header className="admin-panel-header">
        <div><span className="admin-kicker">ALL FORMS</span><h2>전체 설문</h2><p>플랫폼에 있는 모든 설문을 소유자와 무관하게 훑어봅니다. 필드 편집은 각 설문에서 합니다.</p></div>
      </header>
      <ResourceManagerFiltersView resourceLabel="설문" searchId="form-search" search={search} ownerAccount={ownerAccount} updatedFrom={updatedFrom} updatedTo={updatedTo} includeArchived={includeArchived} totalCount={totalCount} pending={pending} onSubmit={submitSearch} onSearchChange={setSearch} onOwnerAccountChange={setOwnerAccount} onUpdatedFromChange={changeUpdatedFrom} onUpdatedToChange={changeUpdatedTo} onIncludeArchivedChange={toggleIncludeArchived} />
      {error ? <p className="admin-global-error" role="alert">{error}</p> : null}
      <div className="admin-table-wrap">
        <table className="admin-user-table admin-sortable-table">
          <thead>
            <tr>
              <AdminSortableHeader column="title" label="설문" sortBy={sortBy} sortDir={sortDir} disabled={includeArchived} onSort={changeSort} />
              <th>소유자</th>
              <th>상태</th>
              <AdminSortableHeader column="fields" label="필드" sortBy={sortBy} sortDir={sortDir} disabled={includeArchived} onSort={changeSort} />
              <AdminSortableHeader column="responses" label="응답" sortBy={sortBy} sortDir={sortDir} disabled={includeArchived} onSort={changeSort} />
              <AdminSortableHeader column="updatedAt" label={includeArchived ? "보관일" : "수정일"} sortBy={sortBy} sortDir={sortDir} onSort={changeSort} />
              <th><span className="sr-only">열기</span></th>
            </tr>
          </thead>
          <tbody>
            {forms.map((form) => (
              <tr key={form.id}>
                <td data-label="설문">{form.title}{form.frozen ? <em className="admin-manager-badge">잠김</em> : null}</td>
                <td data-label="소유자">{form.owner.name || "이름 없음"} <small>{ADMIN_ROLE_LABELS[form.ownerRole]}</small></td>
                <td data-label="상태">{statusLabels[form.status]} <small>{form.requiresLogin ? "로그인 필요" : "공개"}</small></td>
                <td data-label="필드">{form._count.fields}개</td>
                <td data-label="응답">{form._count.responses}개</td>
                <td data-label="수정일">{new Date(form.deletedAt ?? form.updatedAt).toLocaleDateString("ko-KR", { timeZone: "Asia/Seoul" })}</td>
                <td data-label="열기"><Link href={`/s/${form.slug}`} prefetch={false} target="_blank" className="icon-button small" aria-label={`${form.title} 열기`}><ExternalLink size={14} /></Link></td>
              </tr>
            ))}
          </tbody>
        </table>
        {!forms.length && <p className="admin-empty">{search.trim() || ownerAccount.trim() ? "검색 조건에 맞는 설문이 없습니다." : "설문이 없습니다."}</p>}
      </div>
      <AdminPagination page={page} pageSize={pageSize} totalCount={totalCount} pending={pending} onPageChange={(nextPage) => void load(nextPage, pageSize)} onPageSizeChange={changePageSize} />
    </section>
  );
}
