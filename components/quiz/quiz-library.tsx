"use client";

import Link from "next/link";
import dynamic from "next/dynamic";
import { useDialog } from "@/components/ui/app-dialog";
import Image from "next/image";
import {
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  useTransition,
  type FormEvent,
  type ReactNode,
} from "react";
import { useRouter } from "next/navigation";
import {
  Copy,
  FolderOpen,
  Search,
  Share2,
  SortAsc,
  Star,
  Trash2,
  UserPlus,
  X,
} from "lucide-react";
import { GlobeIcon, LockIcon, PlusIcon, QuizIcon } from "@/components/ui/icons";
import { QuizSessionLauncher } from "@/components/quiz/quiz-session-launcher";
import { usePublishNavCounts } from "@/components/shell/nav-counts";
import { Modal } from "@/components/ui/modal";
import { ContentCard, ContentCardBadge, ContentCardGrid } from "@/components/ui/content-card";
import { ContentCardMenuItem, ContentCardMenuSection } from "@/components/ui/content-card-menu";
import { EmptyState, InlineNotice } from "@/components/ui/feedback";
import { PageHeader, PageShell } from "@/components/ui/page-layout";
import { PageNumberNavigation } from "@/components/ui/page-number-navigation";
import libraryStyles from "@/components/ui/content-library.module.css";
import type { SelectableListPage } from "@/components/ui/selectable-list";
import { formatDate } from "@/lib/format";
import { useDebouncedSearch } from "@/lib/use-debounced-search";
import type { LibraryParams } from "@/lib/quiz/library-page";
import { QUIZ_LIBRARY_PATHS } from "@/lib/quiz/library-navigation";
import { notifySidebarDataChanged } from "@/lib/sidebar-events";

// 교사·학생 후보 목록은 공유/할당 모달에서만 씁니다. 퀴즈 보관함의 카드와 검색을 보는
// 대부분의 진입에는 300줄이 넘는 선택 목록·페이지 요청 상태가 필요하지 않습니다.
const SelectableList = dynamic(() => import("@/components/ui/selectable-list").then((mod) => mod.SelectableList), { ssr: false });
const PagedSelectableList = dynamic(() => import("@/components/ui/selectable-list").then((mod) => mod.PagedSelectableList), { ssr: false });
const CourseSelect = dynamic(() => import("@/components/courses/course-select").then((mod) => mod.CourseSelect), { ssr: false });

type QuizItem = {
  id: string;
  title: string;
  description: string | null;
  thumbnailUrl: string | null;
  thumbnailAlt: string | null;
  isPublished: boolean;
  requiresLogin: boolean;
  updatedAt: string;
  subject: { id: string; name: string } | null;
  ownerName: string;
  /** 소유자 계정이 삭제되고 이어받을 교사가 없어 잠긴 퀴즈. 읽기·복제만 됩니다. */
  frozen: boolean;
  accessLevel: "OWNER" | "EDITOR" | "VIEWER";
  favorite: boolean;
  counts: { questions: number; sessions: number; assignments: number };
};

type DialogState = { type: "share" | "assign"; quiz: QuizItem } | null;
type ViewFilter = "ALL" | "FAVORITES" | "ASSIGNED" | "UNASSIGNED" | "DRAFT";
type SortOption = "UPDATED" | "TITLE" | "QUESTIONS";

// 교과목별 강조색은 카드 배경 전체를 칠하지 않고 상단 선과 그룹 표식에만 씁니다.
const SUBJECT_TONES = [
  { color: "var(--brand)", dot: "bg-brand" },
  { color: "var(--accent-soft-fg)", dot: "bg-accent-soft-fg" },
  { color: "var(--info-soft-fg)", dot: "bg-info-soft-fg" },
  { color: "var(--warning-soft-fg)", dot: "bg-warning-soft-fg" },
  { color: "var(--danger-soft-fg)", dot: "bg-danger-soft-fg" },
  { color: "var(--success-soft-fg)", dot: "bg-success-soft-fg" },
] as const;

function toneForSubject(name: string) {
  let hash = 0;
  for (let index = 0; index < name.length; index += 1) hash = (hash * 31 + name.charCodeAt(index)) >>> 0;
  return SUBJECT_TONES[hash % SUBJECT_TONES.length];
}

async function responseData(response: Response) {
  return response.json().catch(() => ({})) as Promise<Record<string, unknown>>;
}

export function QuizLibrary({ viewer, quizzes, canCreate, creationLimit, total, pageSize, viewCounts, sidebarSubjects, unclassifiedCount, ownerFilter, params }: {
  viewer: { id: string; role: "SUPER_ADMIN" | "ADMIN" | "TEACHER" | "STUDENT"; name: string; classLabel: string | null };
  quizzes: QuizItem[];
  canCreate: boolean;
  creationLimit: { used: number; max: number } | null;
  total: number;
  pageSize: number;
  viewCounts: Partial<Record<ViewFilter, number>>;
  sidebarSubjects: Array<{ id: string; name: string; count: number }>;
  unclassifiedCount: number;
  ownerFilter: { id: string; name: string } | null;
  params: LibraryParams;
}) {
  const appDialog = useDialog();
  const router = useRouter();
  const [pendingNav, startNav] = useTransition();
  const [query, setQuery] = useState(params.query);
  // 목록은 서버에서 페이지 단위로 내려오므로, 즐겨찾기 별표만 응답을 기다리지 않고 겹쳐 그립니다.
  const [favoriteOverrides, setFavoriteOverrides] = useState<Map<string, boolean>>(() => new Map());
  const [busy, setBusy] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [dialog, setDialog] = useState<DialogState>(null);
  const [openMenuId, setOpenMenuId] = useState<string | null>(null);
  // 카드 메뉴의 교과목 선택지. 필터 드롭다운이 이미 받는 목록을 그대로 씁니다 — 소유 교과목이라
  // 여기서 고를 수 있는 것과 같습니다.
  const courseOptions = sidebarSubjects.map(({ id, name }) => ({ id, name }));

  // 보기 개수 배지는 셸 사이드바가 그립니다. 여기서 올려 주는 이유는 nav-counts.tsx 주석 참고.
  usePublishNavCounts(viewCounts);

  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const isFavorite = (quiz: QuizItem) => favoriteOverrides.get(quiz.id) ?? quiz.favorite;
  const discover = params.tab === "discover";
  const routePath = discover ? "/quiz/discover" : QUIZ_LIBRARY_PATHS[params.view];
  const viewHref = (view: "ALL" | "ASSIGNED" | "UNASSIGNED") => {
    const search = new URLSearchParams();
    const trimmedQuery = query.trim();
    if (trimmedQuery) search.set("q", trimmedQuery);
    if (params.subject !== "ALL") search.set("subject", params.subject);
    if (params.status !== "ALL") search.set("status", params.status);
    if (params.sort !== "UPDATED") search.set("sort", params.sort);
    if (params.owner) search.set("owner", params.owner);
    const serialized = search.toString();
    return serialized ? `${QUIZ_LIBRARY_PATHS[view]}?${serialized}` : QUIZ_LIBRARY_PATHS[view];
  };

  // 필터·검색·정렬·페이지의 정본은 URL입니다. 여기서 URL만 바꾸면 서버 컴포넌트가 해당
  // 조건으로 다시 조회해 새 props를 내려 줍니다. 페이지는 조건이 바뀔 때 1로 돌아갑니다.
  const navigate = useCallback((next: Partial<LibraryParams>) => {
    const merged = { ...params, page: 1, ...next };
    const search = new URLSearchParams();
    if (merged.query) search.set("q", merged.query);
    if (merged.subject !== "ALL") search.set("subject", merged.subject);
    if (merged.status !== "ALL") search.set("status", merged.status);
    if (merged.sort !== "UPDATED") search.set("sort", merged.sort);
    if (merged.owner) search.set("owner", merged.owner);
    if (merged.page > 1) search.set("page", String(merged.page));
    const queryString = search.toString();
    startNav(() => router.replace(queryString ? `${routePath}?${queryString}` : routePath, { scroll: false }));
  }, [params, routePath, router]);

  useDebouncedSearch({
    value: query,
    committedValue: params.query,
    onSearch: (nextQuery) => navigate({ query: nextQuery }),
  });

  const grouped = useMemo(() => {
    const groups = new Map<string, { name: string; items: QuizItem[] }>();
    for (const quiz of quizzes) {
      const key = quiz.subject?.id ?? "UNCLASSIFIED";
      const group = groups.get(key) ?? { name: quiz.subject?.name ?? "미분류", items: [] };
      group.items.push(quiz);
      groups.set(key, group);
    }
    return [...groups.entries()].sort(([leftKey, left], [rightKey, right]) => {
      if (leftKey === "UNCLASSIFIED") return 1;
      if (rightKey === "UNCLASSIFIED") return -1;
      return left.name.localeCompare(right.name, "ko");
    });
  }, [quizzes]);

  async function toggleFavorite(quiz: QuizItem) {
    setOpenMenuId(null);
    const active = isFavorite(quiz);
    setFavoriteOverrides((current) => new Map(current).set(quiz.id, !active));
    const response = await fetch(`/api/quiz/quizzes/${quiz.id}/favorite`, { method: active ? "DELETE" : "PUT" });
    if (!response.ok) {
      setFavoriteOverrides((current) => new Map(current).set(quiz.id, active));
      const data = await responseData(response);
      setMessage(typeof data.error === "string" ? data.error : "즐겨찾기를 바꾸지 못했습니다.");
      return;
    }
    // 사이드바의 즐겨찾기 개수를 맞춥니다. 별표는 이미 오버레이로 바뀌어 있어 깜빡이지 않습니다.
    router.refresh();
  }

  async function cloneQuiz(quiz: QuizItem) {
    setOpenMenuId(null);
    setBusy(`clone-${quiz.id}`);
    setMessage(null);
    const response = await fetch(`/api/quiz/quizzes/${quiz.id}/clone`, { method: "POST" });
    const data = await responseData(response);
    setBusy(null);
    if (!response.ok || !data.quiz || typeof data.quiz !== "object" || !("id" in data.quiz)) {
      setMessage(typeof data.error === "string" ? data.error : "퀴즈를 복제하지 못했습니다.");
      return;
    }
    router.push(`/quiz/${String(data.quiz.id)}/edit`);
  }

  async function deleteQuiz(quiz: QuizItem) {
    setOpenMenuId(null);
    const ok = await appDialog.confirm({ title: `'${quiz.title}' 퀴즈를 삭제할까요?`, description: "이미 진행한 세션의 결과 기록은 유지됩니다.", danger: true, confirmLabel: "삭제" });
    if (!ok) return;
    setBusy(`delete-${quiz.id}`);
    setMessage(null);
    const response = await fetch(`/api/quiz/quizzes/${quiz.id}`, { method: "DELETE" });
    const data = await responseData(response);
    setBusy(null);
    if (!response.ok) {
      setMessage(typeof data.error === "string" ? data.error : "퀴즈를 삭제하지 못했습니다.");
      return;
    }
    notifySidebarDataChanged("quiz");
    router.refresh();
  }

  function resetFilters() {
    setQuery("");
    startNav(() => router.replace(routePath, { scroll: false }));
  }

  const newQuizAction = canCreate ? (
    <Link href="/quiz/new" className="button primary">
      <PlusIcon className="h-4 w-4" />새 퀴즈
    </Link>
  ) : (
    <span className="inline-flex min-h-11 items-center rounded-lg bg-surface-muted px-4 text-xs font-black text-content-muted">학생 퀴즈 {creationLimit?.max}개 한도</span>
  );

  return (
    <PageShell>
      <section className={libraryStyles.content}>
        <PageHeader
          eyebrow={discover ? "QUIZ DISCOVER" : "QUIZ LIBRARY"}
          title={discover ? "퀴즈 탐색" : "내 퀴즈"}
          description={discover
            ? `다른 선생님이 공개한 퀴즈를 찾아 열람하고 복제합니다. 현재 조건에 ${total}개가 있습니다.`
            : creationLimit
              ? `내가 만든 퀴즈 ${creationLimit.used}/${creationLimit.max}개 중 현재 조건에 ${total}개가 있습니다.`
              : `소유하거나 공유받은 퀴즈 ${viewCounts.ALL ?? total}개 중 현재 조건에 ${total}개가 있습니다.`}
          action={<div className="flex flex-col items-stretch gap-2 sm:items-end">{newQuizAction}{creationLimit ? <div className="w-full min-w-44 rounded-lg bg-surface px-3 py-2 ring-1 ring-line sm:w-52"><div className="flex items-center justify-between text-[11px] font-black text-content-muted"><span>학생 퀴즈 한도</span><span className="tabular-nums">{creationLimit.used}/{creationLimit.max}</span></div><div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-surface-muted"><div className="h-full rounded-full bg-brand" style={{ width: `${Math.min(100, creationLimit.used / creationLimit.max * 100)}%` }} /></div></div> : null}</div>}
        />

        {message ? <div className="mt-5"><InlineNotice tone="error">{message}</InlineNotice></div> : null}

        <div className={libraryStyles.toolbar}>
          <label className={libraryStyles.search}><Search className="h-4 w-4 shrink-0" aria-hidden="true" /><span className="sr-only">퀴즈 검색</span><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="제목, 설명, 교과목 검색" />{query ? <button type="button" onClick={() => setQuery("")} className={libraryStyles.clear} aria-label="검색어 지우기"><X className="h-3.5 w-3.5" /></button> : null}</label>
          <div className={libraryStyles.filters}>
            {discover ? null : <label className={libraryStyles.select}><FolderOpen className="h-4 w-4 shrink-0" aria-hidden="true" /><span className="sr-only">교과목 필터</span><select value={params.subject} onChange={(event) => navigate({ subject: event.target.value })}><option value="ALL">모든 과목 ({viewCounts.ALL ?? total})</option>{sidebarSubjects.map((subject) => <option key={subject.id} value={subject.id}>{subject.name} ({subject.count})</option>)}<option value="UNCLASSIFIED">미분류 ({unclassifiedCount})</option></select></label>}
            <label className={libraryStyles.select}><SortAsc className="h-4 w-4" aria-hidden="true" /><span className="sr-only">퀴즈 정렬</span><select value={params.sort} onChange={(event) => navigate({ sort: event.target.value as SortOption })}><option value="UPDATED">최근 수정순</option><option value="TITLE">가나다순</option><option value="QUESTIONS">문항 많은 순</option></select></label>
          </div>
        </div>

        {ownerFilter ? <div className="mt-4 flex flex-wrap items-center gap-3 rounded-lg border border-brand-300 bg-brand-soft/40 px-4 py-3"><span className="text-sm font-black text-brand-soft-fg">{ownerFilter.name}님 소유의 퀴즈만 표시 중</span><button type="button" onClick={() => navigate({ owner: "" })} className="inline-flex min-h-9 items-center gap-1 rounded-lg px-3 text-xs font-black text-content-muted transition hover:bg-surface hover:text-brand"><X className="h-3.5 w-3.5" />필터 해제</button></div> : null}

        {discover ? null : <><nav className={libraryStyles.chips} aria-label="퀴즈 배정 필터"><FilterLink href={viewHref("ALL")} active={params.view === "ALL"}>전체 퀴즈 {viewCounts.ALL ?? 0}</FilterLink><FilterLink href={viewHref("ASSIGNED")} active={params.view === "ASSIGNED"}>할당 중 {viewCounts.ASSIGNED ?? 0}</FilterLink><FilterLink href={viewHref("UNASSIGNED")} active={params.view === "UNASSIGNED"}>미할당 {viewCounts.UNASSIGNED ?? 0}</FilterLink></nav><div className={libraryStyles.chips} aria-label="퀴즈 상태 필터"><FilterChip active={params.status === "ALL"} onClick={() => navigate({ status: "ALL" })}>모든 상태</FilterChip><FilterChip active={params.status === "PUBLISHED"} onClick={() => navigate({ status: "PUBLISHED" })}>발행됨</FilterChip><FilterChip active={params.status === "DRAFT" || params.view === "DRAFT"} onClick={() => navigate({ status: "DRAFT" })}>초안</FilterChip><FilterChip active={params.status === "LOGIN"} onClick={() => navigate({ status: "LOGIN" })}><LockIcon className="h-3.5 w-3.5" />로그인 참여</FilterChip><FilterChip active={params.status === "OPEN"} onClick={() => navigate({ status: "OPEN" })}><GlobeIcon className="h-3.5 w-3.5" />닉네임 참여</FilterChip></div></>}

        {grouped.length ? <><div className={`${libraryStyles.groupList} transition-opacity ${pendingNav ? "opacity-55" : ""}`}>{grouped.map(([key, group]) => { const tone = toneForSubject(group.name); return <section className={libraryStyles.group} key={key} aria-labelledby={`subject-${key}`}><header className={libraryStyles.groupHeader}><span className={`${libraryStyles.groupMarker} ${tone.dot}`} /><h2 id={`subject-${key}`}>{group.name}</h2><span>{group.items.length}</span></header><ContentCardGrid>{group.items.map((quiz) => <QuizCard key={quiz.id} quiz={quiz} viewerRole={viewer.role} canClone={canCreate} favorite={isFavorite(quiz)} busy={busy} menuOpen={openMenuId === quiz.id} courseOptions={courseOptions} onMenuOpenChange={(open) => setOpenMenuId(open ? quiz.id : null)} onFavorite={() => void toggleFavorite(quiz)} onClone={() => void cloneQuiz(quiz)} onDelete={() => void deleteQuiz(quiz)} onShare={() => { setOpenMenuId(null); setDialog({ type: "share", quiz }); }} onAssign={() => { setOpenMenuId(null); setDialog({ type: "assign", quiz }); }} />)}</ContentCardGrid></section>; })}</div><PageNumberNavigation basePath={routePath} page={params.page} totalPages={totalPages} totalCount={total} params={{ q: params.query || undefined, subject: params.subject !== "ALL" ? params.subject : undefined, status: params.status !== "ALL" ? params.status : undefined, sort: params.sort !== "UPDATED" ? params.sort : undefined, owner: params.owner || undefined }} /></> : <div className={libraryStyles.empty}><EmptyState icon={<QuizIcon className="h-6 w-6" />} title="이 조건에 맞는 퀴즈가 없어요" description="검색어, 교과목 또는 보기를 바꿔 보세요." action={<button type="button" onClick={resetFilters} className="button primary small">필터 초기화</button>} /></div>}
      </section>

      {dialog?.type === "share" ? <ShareDialog quiz={dialog.quiz} onClose={() => setDialog(null)} /> : null}
      {dialog?.type === "assign" ? <AssignmentDialog quiz={dialog.quiz} onClose={() => setDialog(null)} /> : null}
    </PageShell>
  );
}

function FilterChip({ active, onClick, children }: { active: boolean; onClick: () => void; children: ReactNode }) {
  return <button type="button" onClick={onClick} aria-pressed={active} className={libraryStyles.chip}>{children}</button>;
}

function FilterLink({ active, href, children }: { active: boolean; href: string; children: ReactNode }) {
  return <Link href={href} aria-current={active ? "page" : undefined} className={libraryStyles.chip}>{children}</Link>;
}

function QuizCard({ quiz, viewerRole, canClone, favorite, busy, menuOpen, courseOptions, onMenuOpenChange, onFavorite, onClone, onDelete, onShare, onAssign }: {
  quiz: QuizItem;
  courseOptions: Array<{ id: string; name: string }>;
  viewerRole: "SUPER_ADMIN" | "ADMIN" | "TEACHER" | "STUDENT";
  canClone: boolean;
  favorite: boolean;
  busy: string | null;
  menuOpen: boolean;
  onMenuOpenChange: (open: boolean) => void;
  onFavorite: () => void;
  onClone: () => void;
  onDelete: () => void;
  onShare: () => void;
  onAssign: () => void;
}) {
  const canEdit = quiz.accessLevel !== "VIEWER";
  const canOwn = quiz.accessLevel === "OWNER";
  const canTeach = viewerRole !== "STUDENT";
  const href = canEdit ? `/quiz/${quiz.id}/edit` : `/quiz/${quiz.id}`;
  const tone = toneForSubject(quiz.subject?.name ?? "미분류");

  return (
    <ContentCard
      title={quiz.title}
      href={href}
      description={quiz.description || `${quiz.subject?.name || "미분류"} 퀴즈`}
      accentColor={tone.color}
      cover={quiz.thumbnailUrl ? <Image src={quiz.thumbnailUrl} alt={quiz.thumbnailAlt || `${quiz.title} 썸네일`} fill unoptimized sizes="(max-width: 600px) 100vw, 360px" /> : undefined}
      badges={<>
        <ContentCardBadge tone={quiz.isPublished ? "brand" : "muted"}>{quiz.isPublished ? "발행됨" : "초안"}</ContentCardBadge>
        {quiz.accessLevel !== "OWNER" && <ContentCardBadge tone="accent">{quiz.accessLevel === "EDITOR" ? "편집 공유" : "보기 공유"}</ContentCardBadge>}
        {quiz.frozen && <ContentCardBadge tone="muted" title="만든 선생님의 계정이 삭제되어 잠긴 퀴즈입니다. 내용 확인과 복제만 할 수 있어요.">잠김</ContentCardBadge>}
      </>}
      favorite={favorite}
      metadata={<>
        <span>{quiz.accessLevel === "OWNER" ? "내가 만든 퀴즈" : `${quiz.ownerName}님의 퀴즈`}</span>
        <span>문항 {quiz.counts.questions} · 결과 {quiz.counts.sessions} · 할당 {quiz.counts.assignments} · {formatDate(quiz.updatedAt)}</span>
      </>}
      footerLabel={<>{quiz.requiresLogin ? <LockIcon className="h-3.5 w-3.5" /> : <GlobeIcon className="h-3.5 w-3.5" />}{quiz.requiresLogin ? "로그인 참여" : "닉네임 참여"}</>}
      footerAction={canEdit && canTeach
        ? <QuizSessionLauncher quizId={quiz.id} quizTitle={quiz.title} requiresLogin={quiz.requiresLogin} isPublished={quiz.isPublished} compact onAssign={onAssign} />
        : <Link href={href} prefetch={false}>{canEdit ? "수정하기" : "내용 보기"}</Link>}
      menu={{
        open: menuOpen,
        onOpenChange: onMenuOpenChange,
        children: <>
          {canOwn && courseOptions.length > 0 && <ContentCardMenuSection label="교과목">
            <CourseSelect kind="quiz" itemId={quiz.id} value={quiz.subject?.id ?? null} options={courseOptions} label={`${quiz.title} 교과목`} />
          </ContentCardMenuSection>}
          <ContentCardMenuItem icon={<Star size={15} fill={favorite ? "currentColor" : "none"} aria-hidden />} pressed={favorite} onClick={onFavorite}>{favorite ? "즐겨찾기 해제" : "즐겨찾기 추가"}</ContentCardMenuItem>
          <ContentCardMenuItem icon={<Copy size={15} aria-hidden />} onClick={onClone} disabled={!canClone || busy === `clone-${quiz.id}`}>{canClone ? "내 퀴즈로 복제" : "퀴즈 한도 도달"}</ContentCardMenuItem>
          {canOwn && canTeach && <ContentCardMenuItem icon={<Share2 size={15} aria-hidden />} onClick={onShare}>교사에게 공유</ContentCardMenuItem>}
          {canEdit && canTeach && quiz.isPublished && <ContentCardMenuItem icon={<UserPlus size={15} aria-hidden />} onClick={onAssign}>학생에게 할당</ContentCardMenuItem>}
          {canOwn && <ContentCardMenuItem icon={<Trash2 size={15} aria-hidden />} onClick={onDelete} disabled={busy === `delete-${quiz.id}`} danger>퀴즈 삭제</ContentCardMenuItem>}
        </>,
      }}
    />
  );
}

// 다이얼로그마다 담는 내용이 달라 폭을 고를 수 있게 했습니다. 예전에는 전부 sm:max-w-xl(576px)로
// 고정돼, 넓은 화면에서도 목록형 다이얼로그가 좁은 기둥처럼 보였습니다. 공용 Modal
// (components/ui/modal.tsx)의 className으로 넘기는데, Tailwind의 max-w-* 유틸이 아니라
// app/globals.css의 .modal-panel.modal-md/.modal-lg를 씁니다 — .modal-panel의 width가 이미
// 상한(500px)이라 max-width만 넓혀서는 실제로 안 넓어집니다.
const MODAL_WIDTH = { md: "modal-md", lg: "modal-lg" } as const;

// 공유 화면은 상대를 구분할 정도만 필요하므로 서버가 이름·이메일을 마스킹해서 내려줍니다.
// 서버가 보내는 이름은 `maskedLoginIdentifier`입니다(app/api/quiz/quizzes/[quizId]/shares).
// quiz 시절 이름인 `maskedEmail`을 그대로 두었더니 값이 항상 undefined라, 이름이 없는 교사가
// 전부 똑같이 "교사"로 보여 목록에서 서로 구분되지 않았습니다.
type ShareTeacher = { id: string; name: string | null; maskedLoginIdentifier: string | null };
type ShareData = { shares: Array<{ permission: "EDITOR" | "VIEWER"; user: ShareTeacher }>; candidates: ShareTeacher[] };

function ShareDialog({ quiz, onClose }: { quiz: QuizItem; onClose: () => void }) {
  const [data, setData] = useState<ShareData | null>(null);
  const [search, setSearch] = useState("");
  const [selectedTeacher, setSelectedTeacher] = useState<Set<string>>(() => new Set());
  const [permission, setPermission] = useState<"EDITOR" | "VIEWER">("VIEWER");
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const searchInputId = useId();
  const loadControllerRef = useRef<AbortController | null>(null);

  const load = useCallback(async () => {
    loadControllerRef.current?.abort();
    const controller = new AbortController();
    loadControllerRef.current = controller;
    try {
      const response = await fetch(`/api/quiz/quizzes/${quiz.id}/shares`, { signal: controller.signal });
      const result = await responseData(response);
      if (controller.signal.aborted) return;
      if (!response.ok) return setError(typeof result.error === "string" ? result.error : "공유 정보를 불러오지 못했습니다.");
      setData(result as unknown as ShareData);
    } catch (cause) {
      if (!controller.signal.aborted) setError(cause instanceof Error ? cause.message : "공유 정보를 불러오지 못했습니다.");
    }
  }, [quiz.id]);

  useEffect(() => {
    const timer = window.setTimeout(() => void load(), 0);
    return () => {
      window.clearTimeout(timer);
      loadControllerRef.current?.abort();
    };
  }, [load]);

  // 이미 공유 중인 교사도 후보에서 빼지 않고 배지만 붙입니다 — POST가 upsert라 다시 골라
  // 권한만 바꿀 수 있어야 합니다.
  const shareByUserId = useMemo(() => new Map((data?.shares ?? []).map((share) => [share.user.id, share.permission])), [data]);

  // 후보는 이미 최대 300명까지 GET 한 번으로 받아 두었으므로(shares API), 검색어가 바뀔
  // 때마다 서버를 다시 부르지 않고 이 배열만 클라이언트에서 거릅니다. 새 API 호출은 없습니다.
  const teacherItems = useMemo(() => {
    const query = search.trim().toLowerCase();
    const candidates = data?.candidates ?? [];
    const matched = query
      ? candidates.filter((candidate) => (candidate.name ?? "").toLowerCase().includes(query) || (candidate.maskedLoginIdentifier ?? "").toLowerCase().includes(query))
      : candidates;
    return matched.map((candidate) => {
      const existingPermission = shareByUserId.get(candidate.id);
      return {
        id: candidate.id,
        title: candidate.name || candidate.maskedLoginIdentifier || "교사",
        meta: candidate.maskedLoginIdentifier,
        badge: existingPermission ? <em className="select-row-flag">공유 중 · {existingPermission === "EDITOR" ? "편집자" : "보기"}</em> : null,
      };
    });
  }, [data, search, shareByUserId]);

  const userId = selectedTeacher.size ? [...selectedTeacher][0] : "";

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!userId) return;
    setPending(true);
    setError(null);
    const response = await fetch(`/api/quiz/quizzes/${quiz.id}/shares`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ userId, permission }) });
    const result = await responseData(response);
    setPending(false);
    if (!response.ok) return setError(typeof result.error === "string" ? result.error : "공유하지 못했습니다.");
    setSelectedTeacher(new Set());
    await load();
  }

  async function remove(targetId: string) {
    await fetch(`/api/quiz/quizzes/${quiz.id}/shares/${targetId}`, { method: "DELETE" });
    await load();
  }

  return (
    <Modal open onClose={onClose} title={`'${quiz.title}' 공유`} className={MODAL_WIDTH.md}>
      {error ? <div className="mb-4"><InlineNotice tone="error">{error}</InlineNotice></div> : null}
      <form onSubmit={submit} className="rounded-2xl bg-surface p-4 ring-1 ring-line">
        <p className="text-xs font-black text-content-muted">교사 선택</p>
        <div className="mt-2 select-controls">
          <div className="select-search">
            <Search size={15} aria-hidden />
            <label htmlFor={searchInputId} className="sr-only">이름·아이디로 교사 검색</label>
            <input id={searchInputId} value={search} onChange={(event) => setSearch(event.target.value)} placeholder="이름·아이디로 교사 검색" />
          </div>
        </div>
        <SelectableList
          selectionMode="single"
          toolbar={false}
          items={teacherItems}
          selected={selectedTeacher}
          onSelectionChange={(next) => setSelectedTeacher(next)}
          unitLabel="교사"
          unitSuffix="명"
          emptyLabel="일치하는 교사가 없습니다."
          ariaLabel="공유할 교사 선택"
        />
        <fieldset className="mt-4">
          <legend className="text-xs font-black text-content-muted">권한</legend>
          <div className="mt-2 grid grid-cols-2 gap-2">
            <label className={`rounded-xl border p-3 ${permission === "VIEWER" ? "border-brand-500 bg-brand-soft/40" : "border-line"}`}>
              <input type="radio" className="sr-only" checked={permission === "VIEWER"} onChange={() => setPermission("VIEWER")} />
              <b className="text-sm">보기</b>
              <span className="mt-1 block text-[11px] text-content-muted">내용 확인과 복제</span>
            </label>
            <label className={`rounded-xl border p-3 ${permission === "EDITOR" ? "border-brand-500 bg-brand-soft/40" : "border-line"}`}>
              <input type="radio" className="sr-only" checked={permission === "EDITOR"} onChange={() => setPermission("EDITOR")} />
              <b className="text-sm">편집자</b>
              <span className="mt-1 block text-[11px] text-content-muted">문항 수정·발행·진행</span>
            </label>
          </div>
        </fieldset>
        <button type="submit" disabled={!userId || pending} className="mt-4 min-h-11 w-full rounded-xl bg-brand-strong text-sm font-black text-on-brand disabled:opacity-40">{pending ? "공유 중..." : "권한 공유"}</button>
      </form>
      <div className="mt-5">
        <h3 className="text-xs font-black text-content-muted">현재 공유 중</h3>
        {data?.shares.length ? (
          <ul className="mt-2 space-y-2">
            {data.shares.map((share) => (
              <li key={share.user.id} className="flex items-center gap-3 rounded-xl bg-surface px-4 py-3 ring-1 ring-line">
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-black text-content">{share.user.name || share.user.maskedLoginIdentifier || "교사"}</p>
                  <p className="mt-0.5 text-[11px] font-bold text-content-subtle">{share.permission === "EDITOR" ? "편집자" : "보기"}</p>
                </div>
                <button type="button" onClick={() => void remove(share.user.id)} className="rounded-lg px-2 py-1 text-xs font-black text-danger hover:bg-danger-soft">제거</button>
              </li>
            ))}
          </ul>
        ) : (
          <p className="mt-3 text-sm font-bold text-content-subtle">아직 공유한 교사가 없습니다.</p>
        )}
      </div>
    </Modal>
  );
}

// 서버가 실제로 내려주는 모양입니다(app/api/quiz/quizzes/[quizId]/assignments,
// lib/users/student-search.ts의 StudentSearchHit). quiz 시절 이름인 `username`을 그대로
// 두었더니 값이 항상 undefined라 모든 학생이 "아이디 없음"으로 보였던 적이 있습니다 — 타입만
// 맞춰 놓고 서버와 어긋나면 화면은 멀쩡히 뜨므로 눈으로는 안 잡힙니다. 지금은 학급·검색
// 조회로 바뀌어 components/courses/roster-panel.tsx의 RosterStudent와 같은 필드 구성입니다.
type StudentCandidate = { id: string; name: string | null; loginId: string | null; studentNumber: number | null; className: string | null; gradeName: string | null };

// 학급 필터 옵션(lib/quiz/assign-candidates.ts의 AssignClassOption). 모달이 열릴 때
// `?view=classes`로 한 번만 받습니다 — 학생 후보 자체는 학급을 고르거나 검색어를 입력해야
// 아래 PagedSelectableList가 지연 조회합니다(모달을 여는 순간에는 학생 조회가 0회입니다).
type AssignmentClass = { id: string; name: string; gradeName: string | null; studentCount: number };

// 학급 이름은 학교마다 "5반"으로도 "3학년 5반"으로도 들어옵니다. 앞에 학년을 무조건 붙이면
// 후자가 "3학년 3학년 5반"이 되므로, components/courses/roster-panel.tsx의 groupLabel과 같은
// 이유로 헬퍼를 그대로 복사합니다.
function assignmentClassLabel(klass: { name: string; gradeName: string | null }) {
  if (!klass.gradeName) return klass.name;
  return klass.name.includes(klass.gradeName) ? klass.name : `${klass.gradeName} ${klass.name}`;
}

function AssignmentDialog({ quiz, onClose }: { quiz: QuizItem; onClose: () => void }) {
  const router = useRouter();
  const [classes, setClasses] = useState<AssignmentClass[]>([]);
  const [classesError, setClassesError] = useState<string | null>(null);
  const [classId, setClassId] = useState("");
  const [selected, setSelected] = useState<Set<string>>(() => new Set());
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [success, setSuccess] = useState<string | null>(null);

  // 학급 옵션만 한 번 받습니다. 학생 후보는 아래 PagedSelectableList가 학급 선택 또는 검색어
  // 입력 뒤에만 부르므로, 모달을 여는 순간에는 학생 목록 요청이 나가지 않습니다.
  useEffect(() => {
    const controller = new AbortController();
    fetch(`/api/quiz/quizzes/${quiz.id}/assignments?view=classes`, { cache: "no-store", signal: controller.signal })
      .then(async (response) => ({ response, data: await responseData(response) }))
      .then(({ response, data }) => {
        if (controller.signal.aborted) return;
        if (!response.ok) { setClassesError(typeof data.error === "string" ? data.error : "학급 목록을 불러오지 못했습니다."); return; }
        setClasses((data.classes ?? []) as AssignmentClass[]);
      })
      .catch((cause) => {
        if (!controller.signal.aborted) setClassesError(cause instanceof Error ? cause.message : "학급 목록을 불러오지 못했습니다.");
      });
    return () => controller.abort();
  }, [quiz.id]);

  const loadStudents = useCallback(async ({ search, page, signal }: { search: string; page: number; signal: AbortSignal }): Promise<SelectableListPage> => {
    const query = new URLSearchParams({ q: search, page: String(page) });
    if (classId) query.set("classId", classId);
    const response = await fetch(`/api/quiz/quizzes/${quiz.id}/assignments?${query}`, { cache: "no-store", signal });
    const data = await responseData(response);
    if (!response.ok) throw new Error(typeof data.error === "string" ? data.error : "학생 목록을 불러오지 못했습니다.");
    const result = data as unknown as { students: StudentCandidate[]; totalCount: number; page: number; pageSize: number; truncated: boolean };
    return {
      items: result.students.map((student) => ({
        id: student.id,
        title: student.name || student.loginId || "학생",
        meta: [student.gradeName, student.className, student.studentNumber !== null ? `${student.studentNumber}번` : null].filter(Boolean).join(" · ") || null,
      })),
      totalCount: result.totalCount,
      page: result.page,
      pageSize: result.pageSize,
      truncated: result.truncated,
    };
  }, [quiz.id, classId]);

  async function assign() {
    if (!selected.size || selected.size > 100) return;
    setPending(true);
    setError(null);
    setSuccess(null);
    const response = await fetch(`/api/quiz/quizzes/${quiz.id}/assignments`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ studentIds: [...selected] }) });
    const data = await responseData(response);
    setPending(false);
    if (!response.ok) return setError(typeof data.error === "string" ? data.error : "할당하지 못했습니다.");
    setSuccess(`${String(data.assignedCount)}명에게 퀴즈를 할당하고 알림을 보냈습니다.`);
    // 할당해도 후보에서 빠지지 않습니다(재할당을 허용하는 semantics) — 목록을 다시 읽을 필요가 없습니다.
    setSelected(new Set());
    router.refresh();
  }

  return (
    <Modal open onClose={onClose} title={`'${quiz.title}' 할당`} className={MODAL_WIDTH.lg}>
      {classesError ? <div className="mb-4"><InlineNotice tone="error">{classesError}</InlineNotice></div> : null}
      {error ? <div className="mb-4"><InlineNotice tone="error">{error}</InlineNotice></div> : null}
      {success ? <div className="mb-4"><InlineNotice tone="success">{success}</InlineNotice></div> : null}
      {/* 100명은 서버 zod 스키마(studentIds.max(100), app/api/quiz/quizzes/[quizId]/assignments)와 같습니다. */}
      {selected.size > 100 ? <div className="mb-4"><InlineNotice tone="error">한 번에 100명까지 할당할 수 있어요.</InlineNotice></div> : null}
      <PagedSelectableList
        title="학생 선택"
        description="이름·아이디로 검색하거나 학급으로 좁혀 보세요."
        emptyLabel="조건에 맞는 학생이 없습니다."
        searchPlaceholder="이름 또는 아이디로 검색"
        unitLabel="학생"
        unitSuffix="명"
        load={loadStudents}
        selected={selected}
        onSelectionChange={(next) => setSelected(next)}
        busy={pending}
        deferLoad
        ready={classId !== ""}
        idleLabel="학급을 선택하면 그 반 학생이 표시됩니다. 이름·아이디로 검색할 수도 있어요."
        filters={
          <label className="select-filter">
            <span className="sr-only">학급으로 좁히기</span>
            <select value={classId} onChange={(event) => setClassId(event.target.value)}>
              <option value="">학급 선택</option>
              {classes.map((klass) => <option key={klass.id} value={klass.id}>{assignmentClassLabel(klass)} ({klass.studentCount}명)</option>)}
            </select>
          </label>
        }
      />
      <button type="button" onClick={() => void assign()} disabled={!selected.size || selected.size > 100 || pending} className="mt-5 min-h-12 w-full rounded-2xl bg-brand-strong text-sm font-black text-on-brand disabled:opacity-40">{pending ? "할당 중..." : `${selected.size}명에게 할당`}</button>
    </Modal>
  );
}
