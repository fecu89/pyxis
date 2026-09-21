import "server-only";

import type { Prisma } from "@/generated/prisma/client";
import type { CurrentUser } from "@/lib/auth/current-user";
import { canViewAllQuizzes, hasSystemPermission } from "@/lib/auth/authorization";
import { getPrisma } from "@/lib/prisma";

/**
 * 최근 방문 목록에서 다시 열 수 있는 패드의 범위입니다. 비밀번호가 있는 공개 패드는 요청
 * 쿠키를 함께 검증할 수 없는 서버 목록 쿼리에서 제외하고, 소유자·멤버의 접근은 유지합니다.
 */
export function readableVisitedBoardWhere(user: CurrentUser): Prisma.BoardWhereInput {
  if (hasSystemPermission(user, "VIEW_ALL_BOARDS")) return { deletedAt: null };
  return {
    deletedAt: null,
    OR: [
      { ownerId: user.id },
      { members: { some: { userId: user.id } } },
      { discoveryScope: "LINK", passwordHash: null },
      { discoveryScope: "PUBLIC", visitorPermission: { not: "NO_ACCESS" }, passwordHash: null },
    ],
  };
}

/** 메인 대시보드와 패드 사이드바가 함께 쓰는 실제 최근 방문 목록입니다. */
export async function getRecentBoardVisits(user: CurrentUser, take = 8) {
  const visits = await getPrisma().boardVisit.findMany({
    where: { userId: user.id, board: readableVisitedBoardWhere(user) },
    orderBy: { lastVisitedAt: "desc" },
    take,
    select: {
      lastVisitedAt: true,
      board: { select: { id: true, slug: true, title: true } },
    },
  });
  return visits.map(({ board, lastVisitedAt }) => ({
    ...board,
    lastVisitedAt: lastVisitedAt.toISOString(),
  }));
}

export function readableVisitedQuizWhere(user: CurrentUser): Prisma.QuizWhereInput {
  if (canViewAllQuizzes(user)) return { deletedAt: null };
  return {
    deletedAt: null,
    OR: [
      { ownerId: user.id },
      { shares: { some: { userId: user.id } } },
      ...(user.role === "STUDENT" ? [] : [{ isSearchable: true, isPublished: true }]),
    ],
  };
}

export async function getRecentQuizVisits(user: CurrentUser, take = 8) {
  const visits = await getPrisma().quizVisit.findMany({
    where: { userId: user.id, quiz: readableVisitedQuizWhere(user) },
    orderBy: { lastVisitedAt: "desc" },
    take,
    select: {
      lastVisitedAt: true,
      quiz: { select: { id: true, title: true } },
    },
  });
  return visits.map(({ quiz, lastVisitedAt }) => ({
    ...quiz,
    lastVisitedAt: lastVisitedAt.toISOString(),
  }));
}

export function readableVisitedFormWhere(user: CurrentUser): Prisma.FormWhereInput {
  if (canViewAllQuizzes(user)) return { deletedAt: null };
  return {
    deletedAt: null,
    OR: [{ ownerId: user.id }, { shares: { some: { userId: user.id } } }],
  };
}

export async function getRecentFormVisits(user: CurrentUser, take = 8) {
  const visits = await getPrisma().formVisit.findMany({
    where: { userId: user.id, form: readableVisitedFormWhere(user) },
    orderBy: { lastVisitedAt: "desc" },
    take,
    select: {
      lastVisitedAt: true,
      form: { select: { id: true, title: true } },
    },
  });
  return visits.map(({ form, lastVisitedAt }) => ({
    ...form,
    lastVisitedAt: lastVisitedAt.toISOString(),
  }));
}

export type RecentContentVisit = {
  key: string;
  type: "PAD" | "QUIZ" | "FORM";
  title: string;
  href: string;
  lastVisitedAt: string;
};

/** 메인 대시보드는 각 콘텐츠의 수정일을 섞지 않고 사용자별 방문 시각만 합쳐 정렬합니다. */
export async function getRecentContentVisits(user: CurrentUser, take = 8): Promise<RecentContentVisit[]> {
  const [boards, quizzes, forms] = await Promise.all([
    getRecentBoardVisits(user, take),
    getRecentQuizVisits(user, take),
    user.role === "STUDENT" ? Promise.resolve([]) : getRecentFormVisits(user, take),
  ]);
  return [
    ...boards.map((board) => ({ key: `PAD:${board.id}`, type: "PAD" as const, title: board.title, href: `/b/${board.slug}`, lastVisitedAt: board.lastVisitedAt })),
    ...quizzes.map((quiz) => ({ key: `QUIZ:${quiz.id}`, type: "QUIZ" as const, title: quiz.title, href: `/quiz/${quiz.id}`, lastVisitedAt: quiz.lastVisitedAt })),
    ...forms.map((form) => ({ key: `FORM:${form.id}`, type: "FORM" as const, title: form.title, href: `/forms/${form.id}`, lastVisitedAt: form.lastVisitedAt })),
  ]
    .sort((left, right) => Date.parse(right.lastVisitedAt) - Date.parse(left.lastVisitedAt))
    .slice(0, take);
}

export async function recordBoardVisit(boardId: string, userId: string) {
  const now = new Date();
  await getPrisma().boardVisit.upsert({
    where: { boardId_userId: { boardId, userId } },
    create: { boardId, userId, lastVisitedAt: now },
    update: { lastVisitedAt: now },
  });
}

export async function recordQuizVisit(quizId: string, userId: string) {
  const now = new Date();
  await getPrisma().quizVisit.upsert({
    where: { quizId_userId: { quizId, userId } },
    create: { quizId, userId, lastVisitedAt: now },
    update: { lastVisitedAt: now },
  });
}

export async function recordFormVisit(formId: string, userId: string) {
  const now = new Date();
  await getPrisma().formVisit.upsert({
    where: { formId_userId: { formId, userId } },
    create: { formId, userId, lastVisitedAt: now },
    update: { lastVisitedAt: now },
  });
}
