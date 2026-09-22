"use client";

import dynamic from "next/dynamic";
import { useEffect, useMemo, useRef, useState } from "react";
import { Search, SlidersHorizontal, X } from "lucide-react";
import { BulkUserActions, type BulkUpdateResult } from "@/components/admin/bulk-user-actions";
import { AdminPagination } from "@/components/admin/shared/admin-pagination";
import type { AdminActor, AdminUserRecord, SchoolDirectoryItem } from "@/components/admin/types";
import { UserCard } from "@/components/admin/user-card";
import { useDebouncedSearch } from "@/lib/use-debounced-search";

const UserAdminActions = dynamic(() => import("@/components/admin/user-admin-actions").then((module) => module.UserAdminActions));
const PAGE_SIZE_OPTIONS = [10, 50, 100] as const;

export type AdminUserInitialFilters = {
  role: string;
  status: string;
  query: string;
  schoolId: string;
  schoolGroupId: string;
};

export function AdminUsersPanel({ actor, initialUsers, initialTotalCount, initialPage, initialPageSize, initialSearchTruncated, schools, initialFilters }: {
  actor: AdminActor;
  initialUsers: AdminUserRecord[];
  initialTotalCount: number;
  initialPage: number;
  initialPageSize: number;
  initialSearchTruncated: boolean;
  schools: SchoolDirectoryItem[];
  initialFilters: AdminUserInitialFilters;
}) {
  const [users, setUsers] = useState(initialUsers);
  const [totalCount, setTotalCount] = useState(initialTotalCount);
  const [page, setPage] = useState(initialPage);
  const [pageSize, setPageSize] = useState(initialPageSize);
  const [actionUserId, setActionUserId] = useState<string | null>(null);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [roleFilter, setRoleFilter] = useState(initialFilters.role);
  const [statusFilter, setStatusFilter] = useState(initialFilters.status);
  const [queryFilter, setQueryFilter] = useState(initialFilters.query);
  const [appliedQuery, setAppliedQuery] = useState(initialFilters.query);
  const [schoolFilter, setSchoolFilter] = useState(initialFilters.schoolId);
  const [schoolGroupFilter, setSchoolGroupFilter] = useState(initialFilters.schoolGroupId);
  const [filtersOpen, setFiltersOpen] = useState(Boolean(initialFilters.role || initialFilters.status || initialFilters.schoolId || initialFilters.schoolGroupId));
  const [pending, setPending] = useState(false);
  const [searchTruncated, setSearchTruncated] = useState(initialSearchTruncated);
  const [error, setError] = useState("");
  const [bulkNotice, setBulkNotice] = useState("");
  const [bulkFailures, setBulkFailures] = useState<{ userId: string; name: string; reason: string }[]>([]);
  const [selectionAnchor, setSelectionAnchor] = useState<number | null>(null);
  const loadControllerRef = useRef<AbortController | null>(null);
  const filterGroups = schools.find((school) => school.id === schoolFilter)?.groups ?? [];
  const filterClasses = filterGroups.filter((group) => group.type === "CLASS");
  const filterDepartments = filterGroups.filter((group) => group.type === "DEPARTMENT");
  const hasActiveFilters = Boolean(roleFilter || statusFilter || queryFilter.trim() || schoolFilter || schoolGroupFilter);
  const canBulkManageUsers = actor.role === "SUPER_ADMIN"
    || (actor.role === "TEACHER" && actor.isSchoolRepresentative)
    || actor.systemPermissions.some((permission) => permission === "CHANGE_NON_ADMIN_ROLES" || permission === "SUSPEND_USERS");
  const selectableUserIds = canBulkManageUsers ? users.filter((user) => user.id !== actor.id).map((user) => user.id) : [];
  const actionUser = users.find((user) => user.id === actionUserId) ?? null;
  const selectedList = useMemo(() => Array.from(selectedIds), [selectedIds]);

  useEffect(() => () => loadControllerRef.current?.abort(), []);

  useDebouncedSearch({
    value: queryFilter,
    committedValue: appliedQuery,
    minimumLength: 2,
    onSearch: (query) => { void loadUsers(1, pageSize, { query }); },
  });

  async function loadUsers(targetPage: number, targetPageSize: number, overrides: Partial<AdminUserInitialFilters> = {}, preserveSelection = false) {
    loadControllerRef.current?.abort();
    const controller = new AbortController();
    loadControllerRef.current = controller;
    setPending(true);
    setError("");
    try {
      const filters: AdminUserInitialFilters = {
        role: overrides.role ?? roleFilter,
        status: overrides.status ?? statusFilter,
        query: overrides.query ?? appliedQuery,
        schoolId: overrides.schoolId ?? schoolFilter,
        schoolGroupId: overrides.schoolGroupId ?? schoolGroupFilter,
      };
      const query = new URLSearchParams({ page: String(targetPage), pageSize: String(targetPageSize) });
      if (filters.role) query.set("role", filters.role);
      if (filters.status) query.set("status", filters.status);
      const search = filters.query.trim();
      if (search) query.set("q", search);
      if (filters.schoolId) query.set("schoolId", filters.schoolId);
      if (filters.schoolGroupId) query.set("schoolGroupId", filters.schoolGroupId);
      const response = await fetch(`/api/admin/users?${query}`, { cache: "no-store", signal: controller.signal });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "사용자 목록을 불러오지 못했습니다.");
      setUsers(result.users);
      setTotalCount(result.totalCount);
      setPage(result.page);
      setPageSize(result.pageSize);
      setAppliedQuery(search);
      setSearchTruncated(Boolean(result.searchTruncated));
      setActionUserId(null);
      setSelectedIds((current) => preserveSelection
        ? new Set((result.users as AdminUserRecord[]).filter((user) => current.has(user.id)).map((user) => user.id))
        : new Set());
      setSelectionAnchor(null);
    } catch (reason) {
      if (reason instanceof DOMException && reason.name === "AbortError") return;
      setError(reason instanceof Error ? reason.message : "사용자 목록을 불러오지 못했습니다.");
    } finally {
      if (loadControllerRef.current === controller) {
        loadControllerRef.current = null;
        setPending(false);
      }
    }
  }

  function changeRoleFilter(nextRole: string) {
    const selectedGroup = filterGroups.find((group) => group.id === schoolGroupFilter);
    const incompatibleGroup = Boolean(selectedGroup) && (
      (nextRole === "STUDENT" && selectedGroup?.type !== "CLASS")
      || (nextRole === "TEACHER" && selectedGroup?.type !== "DEPARTMENT")
      || nextRole === "ADMIN"
      || nextRole === "SUPER_ADMIN"
    );
    const nextSchoolGroupId = incompatibleGroup ? "" : schoolGroupFilter;
    setRoleFilter(nextRole);
    if (incompatibleGroup) setSchoolGroupFilter("");
    void loadUsers(1, pageSize, { role: nextRole, schoolGroupId: nextSchoolGroupId });
  }

  function changeStatusFilter(nextStatus: string) {
    setStatusFilter(nextStatus);
    void loadUsers(1, pageSize, { status: nextStatus });
  }

  function changeSchoolFilter(nextSchoolId: string) {
    setSchoolFilter(nextSchoolId);
    setSchoolGroupFilter("");
    void loadUsers(1, pageSize, { schoolId: nextSchoolId, schoolGroupId: "" });
  }

  function changeSchoolGroupFilter(nextSchoolGroupId: string) {
    setSchoolGroupFilter(nextSchoolGroupId);
    void loadUsers(1, pageSize, { schoolGroupId: nextSchoolGroupId });
  }

  function resetFilters() {
    setRoleFilter("");
    setStatusFilter("");
    setQueryFilter("");
    setSchoolFilter("");
    setSchoolGroupFilter("");
    void loadUsers(1, pageSize, { role: "", status: "", query: "", schoolId: "", schoolGroupId: "" });
  }

  function updateUser(updated: AdminUserRecord) {
    setUsers((current) => current.map((user) => user.id === updated.id ? updated : user));
  }

  function deleteUser(userId: string) {
    const nextTotalCount = Math.max(0, totalCount - 1);
    const nextPage = Math.min(page, Math.max(1, Math.ceil(nextTotalCount / pageSize)));
    setUsers((current) => current.filter((user) => user.id !== userId));
    setTotalCount(nextTotalCount);
    setActionUserId(null);
    setSelectedIds((current) => { const next = new Set(current); next.delete(userId); return next; });
    void loadUsers(nextPage, pageSize);
  }

  function toggleSelected(userId: string) {
    setSelectedIds((current) => {
      const next = new Set(current);
      if (next.has(userId)) next.delete(userId); else next.add(userId);
      return next;
    });
  }

  function selectRow(userId: string, index: number, event: { shiftKey: boolean }) {
    if (!canBulkManageUsers || userId === actor.id) return;
    if (event.shiftKey && selectionAnchor !== null) {
      const [start, end] = selectionAnchor < index ? [selectionAnchor, index] : [index, selectionAnchor];
      const rangeIds = users.slice(start, end + 1).filter((user) => user.id !== actor.id).map((user) => user.id);
      setSelectedIds((current) => new Set([...current, ...rangeIds]));
      return;
    }
    toggleSelected(userId);
    setSelectionAnchor(index);
  }

  async function onBulkApplied(result: BulkUpdateResult) {
    setSelectedIds(new Set(result.skipped.map(({ userId }) => userId)));
    setSelectionAnchor(null);
    setBulkFailures(result.skipped.map((failure) => ({
      ...failure,
      name: users.find((user) => user.id === failure.userId)?.name || "이름 없음",
    })));
    const changedLabel = result.deleted ? "삭제" : "변경";
    setBulkNotice(result.skipped.length
      ? `${result.updated.length}명 ${changedLabel}, ${result.skipped.length}명은 권한·조건이 맞지 않아 건너뛰었습니다.`
      : `${result.updated.length}명을 ${changedLabel}했습니다.`);
    if (result.updated.length || result.deleted?.length) await loadUsers(page, pageSize, {}, true);
  }

  return (
    <>
      {error ? <p className="admin-global-error" role="alert">{error}</p> : null}
      <section className="admin-panel admin-user-list-panel" data-bulk-open={selectedList.length > 0}>
        <header className="admin-panel-header"><div><span className="admin-kicker">DIRECTORY</span><h2>사용자</h2><p>이름·닉네임·아이디로 찾고 역할과 소속으로 좁혀보세요.</p></div></header>
        <div className="admin-user-search" role="search">
          <div className="admin-search-main">
            <div className="admin-search-field">
              <Search size={17} aria-hidden />
              <label htmlFor="admin-user-account-search" className="sr-only">이름, 닉네임, 로그인 아이디 또는 카카오 이메일 검색</label>
              <input id="admin-user-account-search" type="text" value={queryFilter} onChange={(event) => setQueryFilter(event.target.value)} placeholder="이름, 닉네임, 아이디 또는 카카오 이메일" maxLength={100} autoComplete="off" spellCheck={false} />
              {queryFilter ? <button type="button" className="admin-search-clear" onClick={() => setQueryFilter("")} disabled={pending} aria-label="사용자 검색어 지우기"><X size={15} /></button> : null}
            </div>
            <button type="button" className="admin-filter-toggle" aria-pressed={filtersOpen} aria-expanded={filtersOpen} onClick={() => setFiltersOpen((current) => !current)}>
              <SlidersHorizontal size={15} aria-hidden />필터{hasActiveFilters ? <em className="admin-filter-toggle-dot" aria-hidden /> : null}
            </button>
          </div>
          {filtersOpen ? (
            <div className="admin-filter-row" aria-label="사용자 목록 필터">
              <label><span className="sr-only">역할 필터</span><select value={roleFilter} onChange={(event) => changeRoleFilter(event.target.value)} disabled={pending}><option value="">모든 권한</option><option value="SUPER_ADMIN">전체관리자</option><option value="ADMIN">보조관리자</option><option value="TEACHER">교사</option><option value="STUDENT">학생</option></select></label>
              <label><span className="sr-only">상태 필터</span><select value={statusFilter} onChange={(event) => changeStatusFilter(event.target.value)} disabled={pending}><option value="">모든 상태</option><option value="ACTIVE">활성</option><option value="SUSPENDED">정지</option></select></label>
              <label><span className="sr-only">학교 필터</span><select value={schoolFilter} onChange={(event) => changeSchoolFilter(event.target.value)} disabled={pending}><option value="">모든 학교</option>{schools.map((school) => <option key={school.id} value={school.id}>{school.name}</option>)}</select></label>
              <label>
                <span className="sr-only">반 또는 부서 필터</span>
                <select value={schoolGroupFilter} onChange={(event) => changeSchoolGroupFilter(event.target.value)} disabled={pending || !schoolFilter}>
                  <option value="">모든 반·부서</option>
                  {roleFilter !== "TEACHER" && roleFilter !== "ADMIN" && roleFilter !== "SUPER_ADMIN" && filterClasses.length > 0 ? <optgroup label="학생 반">{filterClasses.map((group) => <option key={group.id} value={group.id}>{group.name}</option>)}</optgroup> : null}
                  {roleFilter !== "STUDENT" && roleFilter !== "ADMIN" && roleFilter !== "SUPER_ADMIN" && filterDepartments.length > 0 ? <optgroup label="교사 부서">{filterDepartments.map((group) => <option key={group.id} value={group.id}>{group.name}</option>)}</optgroup> : null}
                </select>
              </label>
              <div className="admin-filter-meta">
                <span className="admin-filter-result">결과 <b>{totalCount}</b>명</span>
                <button type="button" className="admin-filter-reset" onClick={resetFilters} disabled={pending || !hasActiveFilters}><X size={13} />전체 초기화</button>
              </div>
            </div>
          ) : null}
        </div>

        {searchTruncated ? <p className="admin-search-notice" role="status">검색 범위가 넓어 최근 1,000명 안에서 부분 일치 결과를 확인했습니다. 학교·학급 필터를 함께 사용하면 더 정확합니다.</p> : null}

        {selectedList.length > 0 ? <BulkUserActions actor={actor} selectedIds={selectedList} selectedUsers={users.filter((user) => selectedIds.has(user.id))} schools={schools} onClose={() => { setSelectedIds(new Set()); setSelectionAnchor(null); }} onApplied={onBulkApplied} /> : null}
        {bulkNotice ? <p className="admin-bulk-notice" role="status">{bulkNotice}</p> : null}
        {bulkFailures.length > 0 ? <ul className="admin-bulk-notice" aria-label="저장하지 못한 사용자" role="alert">
          {bulkFailures.map(({ userId, name, reason }) => <li key={userId}>{name}: {reason}</li>)}
        </ul> : null}

        <div className="select-toolbar">
          <span>{selectedIds.size > 0 ? `${selectedIds.size}명 선택됨` : `${users.length}명 표시 중`}</span>
          <div className="select-toolbar-actions">
            <button type="button" className="select-toolbar-button" onClick={() => { setSelectedIds(new Set(selectableUserIds)); setSelectionAnchor(null); }} disabled={selectableUserIds.length === 0 || selectedIds.size === selectableUserIds.length}>전체선택</button>
            <button type="button" className="select-toolbar-button" onClick={() => { setSelectedIds(new Set()); setSelectionAnchor(null); }} disabled={selectedIds.size === 0}>전체 해제</button>
          </div>
        </div>
        <div className="admin-user-card-list">
          {users.map((user, index) => (
            <UserCard key={user.id} actor={actor} user={user} selected={selectedIds.has(user.id)} selectionDisabled={!canBulkManageUsers} onToggleSelected={() => toggleSelected(user.id)} onSelectRow={(event) => selectRow(user.id, index, event)} onOpenActions={() => setActionUserId(user.id)} />
          ))}
          {!users.length ? <p className="admin-empty">조건에 맞는 사용자가 없습니다.</p> : null}
        </div>
        <AdminPagination page={page} pageSize={pageSize} totalCount={totalCount} pending={pending} unit="명" pageSizeOptions={PAGE_SIZE_OPTIONS} onPageChange={(nextPage) => void loadUsers(nextPage, pageSize)} onPageSizeChange={(nextPageSize) => void loadUsers(1, nextPageSize)} />
      </section>
      {actionUser ? (
        <UserAdminActions key={actionUser.id} actor={actor} user={actionUser} schools={schools} onClose={() => setActionUserId(null)} onUpdated={updateUser} onDeleted={deleteUser} onAuditChanged={() => undefined} />
      ) : null}
    </>
  );
}
