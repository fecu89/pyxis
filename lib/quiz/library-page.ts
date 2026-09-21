import "server-only";

import type { Prisma } from "@/generated/prisma/client";
import { canViewAllQuizzes, hasSystemPermission } from "@/lib/auth/authorization";
import type { CurrentUser } from "@/lib/auth/current-user";
import { getPrisma } from "@/lib/prisma";
// quiz에는 학생 실명용 displayNameEncrypted가 따로 있었지만 병합 스키마에는 없습니다.
// pad는 공개 표시 이름을 nameEncrypted 하나로 다루므로 같은 헬퍼를 씁니다.
import { toPublicAuthorDTO } from "@/lib/users/repository";

// 퀴즈 보관함 목록의 서버 페이징 계층입니다. `(library)` 아래의 보기별 정식 라우트와
// 검색·정렬·페이지 쿼리가 같은 함수를 쓰므로 목록 조건의 의미는 여기가 정본입니다.

export const LIBRARY_PAGE_SIZE = 24;

export type LibraryView = "ALL" | "FAVORITES" | "ASSIGNED" | "UNASSIGNED" | "DRAFT";
export type LibraryStatus = "ALL" | "PUBLISHED" | "DRAFT" | "LOGIN" | "OPEN";
export type LibrarySort = "UPDATED" | "TITLE" | "QUESTIONS";

export type LibraryParams = {
  page: number;
  view: LibraryView;
  subject: string; // "ALL" | "UNCLASSIFIED" | 교과목 id
  status: LibraryStatus;
  sort: LibrarySort;
  query: string;
  /** 정식 라우트(`/quiz` 또는 `/quiz/discover`)가 정하는 목록 범위입니다. */
  tab: "mine" | "discover";
  /** 특정 회원 소유 퀴즈만 보기(관리 콘솔에서 진입). 전체 조회 권한이 있을 때만 적용됩니다. */
  owner: string;
};

const VIEWS: LibraryView[] = ["ALL", "FAVORITES", "ASSIGNED", "UNASSIGNED", "DRAFT"];
const STATUSES: LibraryStatus[] = ["ALL", "PUBLISHED", "DRAFT", "LOGIN", "OPEN"];
const SORTS: LibrarySort[] = ["UPDATED", "TITLE", "QUESTIONS"];

/** URL 쿼리(신뢰할 수 없는 입력)를 안전한 파라미터로 좁힙니다. */
export function parseLibraryParams(
  input: Record<string, string | string[] | undefined>,
  tab: LibraryParams["tab"] = "mine",
  routeView?: LibraryView,
): LibraryParams {
  const one = (value: string | string[] | undefined) => (Array.isArray(value) ? value[0] : value) ?? "";
  const page = Math.max(1, Math.min(10000, Math.trunc(Number(one(input.page)) || 1)));
  const view = routeView ?? VIEWS.find((item) => item === one(input.view)) ?? "ALL";
  const status = STATUSES.find((item) => item === one(input.status)) ?? "ALL";
  const sort = SORTS.find((item) => item === one(input.sort)) ?? "UPDATED";
  const subject = one(input.subject) || "ALL";
  const query = one(input.q).trim().slice(0, 80);
  const owner = one(input.owner).slice(0, 40);
  return { page, view, subject, status, sort, query, tab, owner };
}

export async function getQuizLibraryPage(user: CurrentUser, params: LibraryParams) {
  const prisma = getPrisma();
  // 접근 가능한 전체(사이드바 집계의 분모). 필터와 무관하게 고정입니다.
  const baseWhere: Prisma.QuizWhereInput = {
    deletedAt: null,
    ...(canViewAllQuizzes(user) ? {} : { OR: [{ ownerId: user.id }, { shares: { some: { userId: user.id } } }] }),
  };

  // 탐색 탭: 남이 검색 공개한(발행된) 퀴즈. 전체 조회 권한이 있는 관리자는 공개 여부와
  // 무관하게 모든 퀴즈를 검색할 수 있습니다. 잠긴 퀴즈는 새로 찾아 쓰라고 권할 대상이 아니므로
  // 여기서만 뺍니다(이미 소유·공유로 알던 사람의 보관함에는 계속 남습니다).
  const discoverWhere: Prisma.QuizWhereInput = {
    deletedAt: null,
    frozenAt: null,
    ownerId: { not: user.id },
    ...(canViewAllQuizzes(user) ? {} : { isSearchable: true, isPublished: true }),
  };
  const ownerFilterId = params.owner && canViewAllQuizzes(user) ? params.owner : null;
  const listBase = params.tab === "discover" ? discoverWhere : baseWhere;

  const where: Prisma.QuizWhereInput = {
    AND: [
      listBase,
      ownerFilterId ? { ownerId: ownerFilterId } : {},
      params.tab === "discover" ? {}
        : params.view === "FAVORITES" ? { favorites: { some: { userId: user.id } } }
        : params.view === "ASSIGNED" ? { assignments: { some: {} } }
        : params.view === "UNASSIGNED" ? { assignments: { none: {} } }
        : params.view === "DRAFT" ? { isPublished: false }
        : {},
      params.subject === "UNCLASSIFIED" ? { subjectId: null }
        : params.subject !== "ALL" ? { subjectId: params.subject }
        : {},
      params.status === "PUBLISHED" ? { isPublished: true }
        : params.status === "DRAFT" ? { isPublished: false }
        : params.status === "LOGIN" ? { requiresLogin: true }
        : params.status === "OPEN" ? { requiresLogin: false }
        : {},
      // 예전 클라이언트 검색은 소유자 이름도 봤지만, 이름이 암호화 컬럼이라 서버 검색은
      // 제목·설명·과목명까지만 봅니다.
      params.query
        ? {
            OR: [
              { title: { contains: params.query, mode: "insensitive" } },
              { description: { contains: params.query, mode: "insensitive" } },
              { subject: { is: { name: { contains: params.query, mode: "insensitive" } } } },
            ],
          }
        : {},
    ],
  };

  // 같은 정렬값이 이어져도 페이지가 겹치지 않도록 id를 마지막 정렬 키로 둡니다.
  const orderBy: Prisma.QuizOrderByWithRelationInput[] =
    params.sort === "TITLE" ? [{ title: "asc" }, { id: "asc" }]
      : params.sort === "QUESTIONS" ? [{ questions: { _count: "desc" } }, { title: "asc" }, { id: "asc" }]
      : [{ updatedAt: "desc" }, { id: "asc" }];

  const quizSelect = {
    id: true,
    ownerId: true,
    title: true,
    description: true,
    thumbnailUrl: true,
    thumbnailAlt: true,
    isPublished: true,
    requiresLogin: true,
    frozenAt: true,
    updatedAt: true,
    subject: { select: { id: true, name: true } },
    owner: { select: { id: true, nameEncrypted: true, imageEncrypted: true } },
    favorites: { where: { userId: user.id }, select: { userId: true } },
    shares: { where: { userId: user.id }, select: { permission: true } },
    _count: { select: { questions: true, sessions: true, assignments: true } },
  } satisfies Prisma.QuizSelect;
  type LibraryQuiz = Prisma.QuizGetPayload<{ select: typeof quizSelect }>;
  const serializeQuizzes = (quizzes: LibraryQuiz[]) => quizzes.map((quiz) => ({
    id: quiz.id,
    title: quiz.title,
    description: quiz.description,
    thumbnailUrl: quiz.thumbnailUrl,
    thumbnailAlt: quiz.thumbnailAlt,
    isPublished: quiz.isPublished,
    requiresLogin: quiz.requiresLogin,
    updatedAt: quiz.updatedAt.toISOString(),
    subject: quiz.subject,
    ownerName: toPublicAuthorDTO(quiz.owner).name ?? "사용자",
    frozen: quiz.frozenAt !== null,
    accessLevel: (quiz.frozenAt && !hasSystemPermission(user, "EDIT_ANY_QUIZ")
      ? "VIEWER"
      : quiz.ownerId === user.id || hasSystemPermission(user, "EDIT_ANY_QUIZ") ? "OWNER" : quiz.shares[0]?.permission ?? "VIEWER") as "OWNER" | "EDITOR" | "VIEWER",
    favorite: quiz.favorites.length > 0,
    counts: { questions: quiz._count.questions, sessions: quiz._count.sessions, assignments: quiz._count.assignments },
  }));

  // 탐색 페이지는 내 보관함의 즐겨찾기·할당·초안 집계와 교과목 목록을 쓰지 않습니다. 별도
  // 라우트로 나눈 의미가 DB에서도 유지되도록 목록·총합·생성 한도에 필요한 소유 개수만 읽습니다.
  if (params.tab === "discover") {
    const [quizzes, total, ownedCount, owner] = await Promise.all([
      prisma.quiz.findMany({
        where,
        orderBy,
        skip: (params.page - 1) * LIBRARY_PAGE_SIZE,
        take: LIBRARY_PAGE_SIZE,
        select: quizSelect,
      }),
      prisma.quiz.count({ where }),
      prisma.quiz.count({ where: { ownerId: user.id, deletedAt: null } }),
      ownerFilterId
        ? prisma.user.findUnique({ where: { id: ownerFilterId }, select: { id: true, nameEncrypted: true, imageEncrypted: true } })
        : Promise.resolve(null),
    ]);
    return {
      ownerFilter: owner ? { id: owner.id, name: toPublicAuthorDTO(owner).name ?? "이름 없음" } : null,
      items: serializeQuizzes(quizzes),
      total,
      pageSize: LIBRARY_PAGE_SIZE,
      viewCounts: {},
      sidebarSubjects: [],
      unclassifiedCount: 0,
      ownedCount,
    };
  }

  const [quizzes, total, allCount, favoriteCount, assignedCount, draftCount, subjectGroups, ownedSubjects, ownedCount] = await Promise.all([
    prisma.quiz.findMany({
      where,
      orderBy,
      skip: (params.page - 1) * LIBRARY_PAGE_SIZE,
      take: LIBRARY_PAGE_SIZE,
      select: quizSelect,
    }),
    prisma.quiz.count({ where }),
    prisma.quiz.count({ where: baseWhere }),
    prisma.quiz.count({ where: { AND: [baseWhere, { favorites: { some: { userId: user.id } } }] } }),
    prisma.quiz.count({ where: { AND: [baseWhere, { assignments: { some: {} } }] } }),
    prisma.quiz.count({ where: { AND: [baseWhere, { isPublished: false }] } }),
    prisma.quiz.groupBy({ by: ["subjectId"], where: baseWhere, _count: { _all: true } }),
    prisma.subject.findMany({
      where: { ownerId: user.id },
      orderBy: { name: "asc" },
      select: { id: true, name: true, _count: { select: { quizzes: { where: { deletedAt: null } } } } },
    }),
    prisma.quiz.count({ where: { ownerId: user.id, deletedAt: null } }),
  ]);

  // 사이드바 과목 목록: 내가 만든 과목(0개여도 표시) + 공유받은 퀴즈로만 알게 된 과목.
  const countBySubject = new Map(subjectGroups.map((group) => [group.subjectId, group._count._all]));
  const extraSubjectIds = [...countBySubject.keys()].filter(
    (id): id is string => id !== null && !ownedSubjects.some((subject) => subject.id === id),
  );
  const extraSubjects = extraSubjectIds.length
    ? await prisma.subject.findMany({ where: { id: { in: extraSubjectIds } }, select: { id: true, name: true } })
    : [];
  const sidebarSubjects = [
    ...ownedSubjects.map((subject) => ({ id: subject.id, name: subject.name, count: countBySubject.get(subject.id) ?? 0 })),
    ...extraSubjects.map((subject) => ({ id: subject.id, name: subject.name, count: countBySubject.get(subject.id) ?? 0 })),
  ].sort((left, right) => left.name.localeCompare(right.name, "ko"));

  const ownerFilter = ownerFilterId
    ? await prisma.user.findUnique({ where: { id: ownerFilterId }, select: { id: true, nameEncrypted: true, imageEncrypted: true } })
        .then((owner) => (owner ? { id: owner.id, name: toPublicAuthorDTO(owner).name ?? "이름 없음" } : null))
    : null;

  return {
    ownerFilter,
    items: serializeQuizzes(quizzes),
    total,
    pageSize: LIBRARY_PAGE_SIZE,
    viewCounts: {
      ALL: allCount,
      FAVORITES: favoriteCount,
      ASSIGNED: assignedCount,
      UNASSIGNED: allCount - assignedCount,
      DRAFT: draftCount,
    },
    sidebarSubjects,
    unclassifiedCount: countBySubject.get(null) ?? 0,
    ownedCount,
  };
}
