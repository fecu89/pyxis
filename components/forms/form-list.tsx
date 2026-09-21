"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useMemo, useState, useTransition } from "react";
import { FileText, Plus, Search, SortAsc, X } from "lucide-react";
import { FormListCard } from "@/components/forms/form-list-card";
import { ContentCardGrid } from "@/components/ui/content-card";
import { EmptyState, InlineNotice } from "@/components/ui/feedback";
import libraryStyles from "@/components/ui/content-library.module.css";
import { PageHeader, PageShell } from "@/components/ui/page-layout";
import { PageNumberNavigation } from "@/components/ui/page-number-navigation";
import type { FormListItem } from "@/lib/forms/list";
import { FORM_LIST_PATHS, type FormListView } from "@/lib/forms/navigation";
import { useDebouncedSearch } from "@/lib/use-debounced-search";
import { notifySidebarDataChanged } from "@/lib/sidebar-events";

const STATUS_ORDER = ["OPEN", "DRAFT", "CLOSED"] as const;
const STATUS_LOOK = {
  OPEN: { label: "응답 받는 중", tone: "brand" },
  DRAFT: { label: "초안", tone: "muted" },
  CLOSED: { label: "마감", tone: "warning" },
} as const;
const VIEW_LABEL: Record<FormListView, string> = {
  ALL: "전체",
  OPEN: "응답 중",
  DRAFT: "초안",
  CLOSED: "마감",
};

type FormSort = "UPDATED" | "TITLE" | "RESPONSES";

function libraryHref(view: FormListView, query: string, sort: FormSort) {
  const params = new URLSearchParams();
  if (query) params.set("q", query);
  if (sort !== "UPDATED") params.set("sort", sort);
  const serialized = params.toString();
  return serialized ? `${FORM_LIST_PATHS[view]}?${serialized}` : FORM_LIST_PATHS[view];
}

export function FormList({ forms, counts, view, page, total, totalPages, query, sort }: {
  forms: FormListItem[];
  counts: Record<FormListView, number>;
  view: FormListView;
  page: number;
  total: number;
  totalPages: number;
  query: string;
  sort: FormSort;
}) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [openMenuId, setOpenMenuId] = useState<string | null>(null);
  const [queryDraft, setQueryDraft] = useState(query);
  const [sortDraft, setSortDraft] = useState<FormSort>(sort);
  const [isNavigating, startNavigation] = useTransition();

  const navigate = useCallback((nextQuery: string, nextSort: FormSort) => {
    startNavigation(() => router.replace(libraryHref(view, nextQuery.trim(), nextSort), { scroll: false }));
  }, [router, view]);

  useDebouncedSearch({
    value: queryDraft,
    committedValue: query,
    onSearch: (nextQuery) => navigate(nextQuery, sortDraft),
  });

  const groups = useMemo(() => STATUS_ORDER.flatMap((status) => {
    const items = forms.filter((form) => form.status === status);
    return items.length ? [{ status, items }] : [];
  }), [forms]);

  async function createForm() {
    setCreating(true);
    setError(null);
    try {
      const response = await fetch("/api/forms", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title: "제목 없는 설문지" }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok || !data.form) {
        setError(typeof data.error === "string" ? data.error : "설문을 만들지 못했습니다.");
        return;
      }
      notifySidebarDataChanged("form");
      router.push(`/forms/${data.form.id}/edit`);
    } catch {
      setError("네트워크 연결을 확인한 뒤 다시 시도해 주세요.");
    } finally {
      setCreating(false);
    }
  }

  const createAction = (
    <button type="button" onClick={() => void createForm()} disabled={creating} className="button primary max-sm:w-full">
      <Plus size={17} aria-hidden />{creating ? "만드는 중..." : "새 설문"}
    </button>
  );

  return (
    <PageShell>
      <section className={libraryStyles.content} aria-busy={isNavigating}>
        <PageHeader
          eyebrow="FORM LIBRARY"
          title="내 설문"
          description={`소유하거나 공유받은 설문 ${counts.ALL}개 중 현재 조건에 ${total}개가 있습니다.`}
          action={createAction}
        />

        {error ? <div className="mb-4"><InlineNotice tone="error">{error}</InlineNotice></div> : null}

        <div className={libraryStyles.toolbar} role="search">
          <label className={libraryStyles.search}>
            <Search size={16} aria-hidden />
            <span className="sr-only">설문 검색</span>
            <input
              type="search"
              value={queryDraft}
              onChange={(event) => setQueryDraft(event.target.value)}
              placeholder="제목, 설명 또는 교과목 검색"
            />
            {queryDraft ? (
              <button type="button" className={libraryStyles.clear} aria-label="검색어 지우기" onClick={() => setQueryDraft("")}>
                <X size={15} aria-hidden />
              </button>
            ) : null}
          </label>
          <div className={libraryStyles.filters}>
            <label className={libraryStyles.select}>
              <SortAsc size={15} aria-hidden />
              <span className="sr-only">설문 정렬</span>
              <select value={sortDraft} onChange={(event) => {
                const nextSort = event.target.value as FormSort;
                setSortDraft(nextSort);
                navigate(queryDraft, nextSort);
              }}>
                <option value="UPDATED">최근 수정순</option>
                <option value="TITLE">가나다순</option>
                <option value="RESPONSES">응답 많은순</option>
              </select>
            </label>
          </div>
        </div>

        <nav className={libraryStyles.chips} aria-label="설문 상태 필터">
          {(["ALL", "OPEN", "DRAFT", "CLOSED"] as const).map((item) => (
            <Link
              key={item}
              href={libraryHref(item, queryDraft.trim(), sortDraft)}
              className={libraryStyles.chip}
              aria-current={view === item ? "page" : undefined}
            >
              {VIEW_LABEL[item]} {counts[item]}
            </Link>
          ))}
        </nav>

        {groups.length ? (
          <div className={libraryStyles.groupList} style={{ opacity: isNavigating ? 0.55 : 1 }}>
            {groups.map(({ status, items }) => {
              const look = STATUS_LOOK[status];
              const tone = look.tone === "brand" ? undefined : look.tone;
              return (
                <section className={libraryStyles.group} key={status} aria-labelledby={`forms-${status}`}>
                  <header className={libraryStyles.groupHeader}>
                    <span className={libraryStyles.groupMarker} data-tone={tone} />
                    <h2 id={`forms-${status}`}>{look.label}</h2>
                    <span>{items.length}</span>
                  </header>
                  <ContentCardGrid>
                    {items.map((form) => (
                      <FormListCard
                        key={form.id}
                        form={form}
                        menuOpen={openMenuId === form.id}
                        onMenuOpenChange={(open) => setOpenMenuId(open ? form.id : null)}
                        onError={setError}
                        onChanged={() => { notifySidebarDataChanged("form"); startNavigation(() => router.refresh()); }}
                      />
                    ))}
                  </ContentCardGrid>
                </section>
              );
            })}
          </div>
        ) : (
          <div className={libraryStyles.empty}>
            <EmptyState
              icon={<FileText size={24} />}
              title={query ? `“${query}” 검색 결과가 없습니다` : `${VIEW_LABEL[view]} 설문이 없습니다`}
              description={query ? "제목, 설명 또는 교과목을 다른 검색어로 입력해 보세요." : "새 설문을 만들어 질문을 넣고 링크로 응답을 받아 보세요."}
              action={query
                ? <button type="button" className="button soft small" onClick={() => setQueryDraft("")}>검색 지우기</button>
                : createAction}
            />
          </div>
        )}

        <PageNumberNavigation
          basePath={FORM_LIST_PATHS[view]}
          page={page}
          totalPages={totalPages}
          totalCount={total}
          params={{ q: query || undefined, sort: sort === "UPDATED" ? undefined : sort }}
        />
      </section>
    </PageShell>
  );
}
