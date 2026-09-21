"use client";

import { useState } from "react";
import { Archive, ArrowDown, ArrowUp, Search, SlidersHorizontal } from "lucide-react";

export function ResourceManagerFilters({ resourceLabel, searchId, search, ownerAccount, updatedFrom, updatedTo, includeArchived, totalCount, pending, onSubmit, onSearchChange, onOwnerAccountChange, onUpdatedFromChange, onUpdatedToChange, onIncludeArchivedChange }: {
  resourceLabel: string;
  searchId: string;
  search: string;
  ownerAccount: string;
  updatedFrom: string;
  updatedTo: string;
  includeArchived: boolean;
  totalCount: number;
  pending: boolean;
  onSubmit: () => void;
  onSearchChange: (value: string) => void;
  onOwnerAccountChange: (value: string) => void;
  onUpdatedFromChange: (value: string) => void;
  onUpdatedToChange: (value: string) => void;
  onIncludeArchivedChange: () => void;
}) {
  const [mobileFiltersOpen, setMobileFiltersOpen] = useState(false);
  const hasActiveFilters = Boolean(ownerAccount.trim() || updatedFrom || updatedTo || includeArchived);

  return (
    <form className="admin-user-search" onSubmit={(event) => { event.preventDefault(); onSubmit(); }}>
      <div className="admin-search-main">
        <div className="admin-search-field">
          <Search size={17} aria-hidden />
          <label htmlFor={searchId} className="sr-only">{resourceLabel} 제목 검색</label>
          <input id={searchId} type="text" value={search} onChange={(event) => onSearchChange(event.target.value)} placeholder={`${resourceLabel} 제목 검색`} autoComplete="off" disabled={pending} />
        </div>
        <button className="button primary admin-resource-search-submit" disabled={pending}><Search size={15} />검색</button>
      </div>
      <button type="button" className="admin-resource-filter-toggle" aria-expanded={mobileFiltersOpen} aria-pressed={hasActiveFilters} onClick={() => setMobileFiltersOpen((current) => !current)}>
        <span><SlidersHorizontal size={15} />상세 필터</span><em>결과 {totalCount}개</em>
      </button>
      <div className="admin-filter-row" data-resource-open={mobileFiltersOpen} aria-label={`전체 ${resourceLabel} 필터`}>
        <span className="admin-filter-heading">소유자</span>
        <label>
          <span className="sr-only">소유자 로그인 아이디 또는 카카오 이메일 정확 검색</span>
          <input type="text" value={ownerAccount} onChange={(event) => onOwnerAccountChange(event.target.value)} placeholder="아이디 또는 카카오 이메일" autoComplete="off" autoCapitalize="none" spellCheck={false} disabled={pending} />
        </label>
        <span className="admin-filter-heading">수정일</span>
        <label><span className="sr-only">수정일 시작</span><input type="date" value={updatedFrom} onChange={(event) => onUpdatedFromChange(event.target.value)} disabled={pending} /></label>
        <label><span className="sr-only">수정일 끝</span><input type="date" value={updatedTo} onChange={(event) => onUpdatedToChange(event.target.value)} disabled={pending} /></label>
        <button type="button" className="admin-archive-toggle" aria-pressed={includeArchived} onClick={onIncludeArchivedChange} disabled={pending}>
          <Archive size={13} aria-hidden />보관된 {resourceLabel}만 보기
        </button>
        <div className="admin-filter-meta"><span className="admin-filter-result">결과 <b>{totalCount}</b>개</span></div>
      </div>
    </form>
  );
}

export function AdminSortableHeader<Column extends string>({ column, label, sortBy, sortDir, disabled = false, onSort }: {
  column: Column;
  label: string;
  sortBy: Column;
  sortDir: "asc" | "desc";
  disabled?: boolean;
  onSort: (column: Column) => void;
}) {
  const active = sortBy === column;
  return (
    <th aria-sort={active ? (sortDir === "asc" ? "ascending" : "descending") : "none"}>
      <button type="button" className="admin-sort-header" onClick={() => onSort(column)} disabled={disabled}>
        {label}{active ? sortDir === "asc" ? <ArrowUp size={11} aria-hidden /> : <ArrowDown size={11} aria-hidden /> : null}
      </button>
    </th>
  );
}
