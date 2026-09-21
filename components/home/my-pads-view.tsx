"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useMemo, useState, useTransition } from "react";
import { ArrowRight, Copy, Eye, Hourglass, LayoutTemplate, PencilLine, Plus, Search, ShieldCheck, SortAsc, Star, Users, X, XCircle } from "lucide-react";
import { CreateBoardButton } from "@/components/home/create-board-actions";
import { PadGrid, sortPads, type DashboardSort } from "@/components/home/pad-grid";
import { PadReuseDialog } from "@/components/home/pad-reuse-dialog";
import { EmptyState } from "@/components/ui/feedback";
import { PageHeader } from "@/components/ui/page-layout";
import libraryStyles from "@/components/ui/content-library.module.css";
import styles from "@/components/home/pad-dashboard.module.css";
import { APP_NAME } from "@/lib/brand";
import type { AccessRequestBoard, DashboardBoard, DashboardBoardRelation, DashboardFolder, TemplateBoard } from "@/lib/dashboard/types";
import { useDebouncedSearch } from "@/lib/use-debounced-search";

const relationLabel: Record<DashboardBoardRelation, string> = {
  OWNED: "내가 만든 패드",
  SHARED: "참여한 패드",
  MANAGED: "관리 권한으로 보는 패드",
  SAVED: "저장한 공개 패드",
};

type PadFilter = "ALL" | "OWNED" | "PARTICIPATING" | "WRITABLE" | "READ_ONLY";

export function MyPadsView({
  boards,
  accessRequestBoards,
  folders,
  templateBoards,
  viewerName,
  viewerRole,
  canCreateBoard,
  initialQuery = "",
}: {
  boards: DashboardBoard[];
  accessRequestBoards: AccessRequestBoard[];
  folders: DashboardFolder[];
  templateBoards: TemplateBoard[];
  viewerName: string;
  viewerRole: "SUPER_ADMIN" | "ADMIN" | "TEACHER" | "STUDENT";
  canCreateBoard: boolean;
  initialQuery?: string;
}) {
  const router = useRouter();
  const [searchPending, startSearch] = useTransition();
  const hasParticipatingBoards = boards.some((board) => board.relation === "SHARED");
  const [filter, setFilter] = useState<PadFilter>(
    viewerRole === "STUDENT" && hasParticipatingBoards ? "PARTICIPATING" : "ALL",
  );
  const [sort, setSort] = useState<DashboardSort>("UPDATED_DESC");
  const [searchDraft, setSearchDraft] = useState(initialQuery);
  const [reuseBoard, setReuseBoard] = useState<TemplateBoard | null>(null);
  const [templateFavoriteOverrides, setTemplateFavoriteOverrides] = useState<Record<string, boolean>>({});
  const normalizedQuery = initialQuery.trim().toLocaleLowerCase("ko");

  const navigateSearch = useCallback((query: string) => {
    const params = new URLSearchParams();
    if (query) params.set("q", query);
    const serialized = params.toString();
    startSearch(() => router.replace(serialized ? `/pad?${serialized}` : "/pad", { scroll: false }));
  }, [router]);

  useDebouncedSearch({
    value: searchDraft,
    committedValue: initialQuery,
    onSearch: navigateSearch,
  });

  const groups = useMemo(() => {
    const visible = boards.filter((board) => {
      if (normalizedQuery && !`${board.title} ${board.owner.name ?? ""}`.toLocaleLowerCase("ko").includes(normalizedQuery)) return false;
      if (filter === "ALL") return true;
      if (filter === "OWNED") return board.relation === "OWNED";
      if (filter === "PARTICIPATING") return board.relation === "SHARED";
      if (filter === "WRITABLE") return board.relation === "SHARED" && board.canWritePosts;
      return board.relation === "SHARED" && !board.canWritePosts;
    });
    const sorted = sortPads(visible, sort);
    const relationOrder: DashboardBoardRelation[] = viewerRole === "STUDENT"
      ? ["SHARED", "OWNED", "SAVED", "MANAGED"]
      : ["OWNED", "SHARED", "MANAGED", "SAVED"];
    return relationOrder
      .map((relation) => ({ relation, boards: sorted.filter((board) => board.relation === relation) }))
      .filter((group) => group.boards.length);
  }, [boards, filter, normalizedQuery, sort, viewerRole]);
  const ownedCount = boards.filter((board) => board.relation === "OWNED").length;
  const participatingBoards = boards.filter((board) => board.relation === "SHARED");
  const writableCount = participatingBoards.filter((board) => board.canWritePosts).length;
  const readOnlyCount = participatingBoards.length - writableCount;

  return (
    <section className={libraryStyles.content} data-home-dashboard aria-busy={searchPending}>
      <PageHeader
        eyebrow="PAD LIBRARY"
        title="내 패드"
        description={`${viewerName}님이 만들거나 참여한 패드 ${boards.length}개를 관리합니다.`}
        action={canCreateBoard ? <CreateBoardButton className="button primary max-sm:w-full"><Plus size={17} />새 패드</CreateBoardButton> : undefined}
      />

      <div className={libraryStyles.toolbar} role="search">
        <div className={libraryStyles.search}>
          <Search size={16} aria-hidden />
          <label className={styles.visuallyHidden} htmlFor="pad-search">패드 검색</label>
          <input id="pad-search" name="q" type="search" value={searchDraft} onChange={(event) => setSearchDraft(event.target.value)} placeholder="제목 또는 소유자 검색" />
          {searchDraft ? <button type="button" className={libraryStyles.clear} aria-label="검색어 지우기" onClick={() => setSearchDraft("")}><X size={15} aria-hidden /></button> : null}
        </div>
        <div className={libraryStyles.filters}><label className={libraryStyles.select}><SortAsc size={15} aria-hidden /><span className={styles.visuallyHidden}>패드 정렬</span><select value={sort} onChange={(event) => setSort(event.target.value as DashboardSort)}><option value="UPDATED_DESC">최근 수정순</option><option value="TITLE_ASC">가나다순</option></select></label></div>
      </div>

      {(ownedCount > 0 || participatingBoards.length > 0) && (
        <nav className={libraryStyles.chips} aria-label="패드 관계 필터">
          <button className={libraryStyles.chip} type="button" aria-pressed={filter === "ALL"} onClick={() => setFilter("ALL")}>전체 {boards.length}</button>
          {participatingBoards.length > 0 && <button className={libraryStyles.chip} type="button" aria-pressed={filter === "PARTICIPATING"} onClick={() => setFilter("PARTICIPATING")}><Users size={14} aria-hidden />참여한 패드 {participatingBoards.length}</button>}
          {writableCount > 0 && <button className={libraryStyles.chip} type="button" aria-pressed={filter === "WRITABLE"} onClick={() => setFilter("WRITABLE")}><PencilLine size={14} aria-hidden />글쓰기 가능 {writableCount}</button>}
          {readOnlyCount > 0 && <button className={libraryStyles.chip} type="button" aria-pressed={filter === "READ_ONLY"} onClick={() => setFilter("READ_ONLY")}><Eye size={14} aria-hidden />보기 전용 {readOnlyCount}</button>}
          {ownedCount > 0 && <button className={libraryStyles.chip} type="button" aria-pressed={filter === "OWNED"} onClick={() => setFilter("OWNED")}><ShieldCheck size={14} aria-hidden />내가 만든 패드 {ownedCount}</button>}
        </nav>
      )}

      {groups.length > 0
        ? <div className={libraryStyles.groupList}>{groups.map((group) => (
            <section className={libraryStyles.group} key={group.relation} aria-labelledby={`dashboard-${group.relation}`}>
              <header className={libraryStyles.groupHeader}><span className={libraryStyles.groupMarker} /><h2 id={`dashboard-${group.relation}`}>{relationLabel[group.relation]}</h2><span>{group.boards.length}</span></header>
              <PadGrid boards={group.boards} folders={folders} canCreateBoard={canCreateBoard} headingLevel={3} />
            </section>
          ))}</div>
        : normalizedQuery
          ? <div className={libraryStyles.empty}><EmptyState icon={<Search size={24} />} title={`“${initialQuery.trim()}” 검색 결과가 없습니다`} description="제목이나 소유자 이름을 다른 검색어로 입력해 보세요." action={<button type="button" className="button soft small" onClick={() => setSearchDraft("")}>검색 지우기</button>} /></div>
        : filter !== "ALL"
          ? <div className={libraryStyles.empty}><EmptyState icon={<Users size={24} />} title="이 조건에 맞는 패드가 없습니다" description="다른 참여 권한을 선택하거나 전체 패드를 확인해 보세요." action={<button type="button" className="button soft small" onClick={() => setFilter("ALL")}>전체 보기</button>} /></div>
        : canCreateBoard
          ? <div className={libraryStyles.empty}><EmptyState icon={<Plus size={24} />} title="첫 번째 패드를 만들어 보세요" description="제목만 정하면 바로 시작할 수 있어요." action={<CreateBoardButton className="button primary small">새 패드</CreateBoardButton>} /></div>
          : <div className={libraryStyles.empty}><EmptyState icon={<Users size={24} />} title="아직 참여 중인 패드가 없습니다" description="교사에게 패드 초대 또는 접근 승인을 요청해 주세요." /></div>}

      {!normalizedQuery && canCreateBoard && templateBoards.length > 0 && <section className={styles.templates} aria-labelledby="template-title"><header className={styles.subheading}><h2 id="template-title"><LayoutTemplate size={17} aria-hidden />템플릿으로 시작하기</h2><span>{templateBoards.length}개</span></header><div className={styles.templateGrid}>{templateBoards.map((board) => {
        const isFavorite = templateFavoriteOverrides[board.id] ?? board.isFavorite;
        return <article className={styles.templateCard} key={board.id}><Link href={`/b/${board.slug}`}><span>{board.discoveryScope === "PUBLIC" ? "공개 템플릿" : "내 템플릿"}</span><h3>{board.title}</h3><p>{board.owner.name || APP_NAME} · {board._count.posts}개 글</p></Link><div><button type="button" aria-label={isFavorite ? `${board.title} 즐겨찾기 해제` : `${board.title} 즐겨찾기`} aria-pressed={isFavorite} onClick={() => { void fetch(`/api/boards/${board.id}/favorite`, { method: isFavorite ? "DELETE" : "PUT" }).then((response) => { if (response.ok) setTemplateFavoriteOverrides((current) => ({ ...current, [board.id]: !isFavorite })); }); }}><Star size={14} fill={isFavorite ? "currentColor" : "none"} aria-hidden /></button><button type="button" onClick={() => setReuseBoard(board)}><Copy size={14} aria-hidden />사용하기</button></div></article>;
      })}</div></section>}

      {!normalizedQuery && accessRequestBoards.length > 0 && <section className={styles.requests} aria-labelledby="access-request-title"><header className={styles.subheading}><h2 id="access-request-title"><Hourglass size={17} aria-hidden />접근 요청 상태</h2><span>{accessRequestBoards.length}개</span></header><div className={styles.requestGrid}>{accessRequestBoards.map((board) => <Link className={styles.request} data-status={board.requestStatus} href={`/b/${board.slug}`} key={board.id}><span className={styles.requestIcon}>{board.requestStatus === "PENDING" ? <Hourglass size={17} aria-hidden /> : <XCircle size={17} aria-hidden />}</span><span className={styles.requestCopy}><b>{board.title}</b><small>{board.requestStatus === "PENDING" ? "소유자의 승인을 기다리고 있습니다." : "요청이 거절되었습니다. 패드 안내에서 다시 요청할 수 있습니다."}</small></span><ArrowRight size={16} aria-hidden /></Link>)}</div></section>}

      {reuseBoard && <PadReuseDialog board={reuseBoard} onClose={() => setReuseBoard(null)} />}
    </section>
  );
}
