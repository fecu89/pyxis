import "server-only";

import type { Prisma } from "@/generated/prisma/client";
import { getPrisma } from "@/lib/prisma";

/**
 * 교과목에 붙일 수 있는 퀴즈·패드 목록입니다. 예전에는 소유한 전부를 한 번에 내려보내고
 * 클라이언트가 체크박스로 들고 있었는데, 퀴즈가 수백 개면 교과목을 펼칠 때마다 그만큼이
 * DOM에 올라갑니다. 이제 검색과 페이지 단위로만 읽습니다.
 *
 * 제목은 암호화 필드가 아니라 평문이라 학생 명단과 달리 검색·정렬을 DB에 그대로 맡깁니다.
 */
export const RESOURCE_PAGE_SIZE = 20;

export type ResourceKind = "quiz" | "board" | "form";

export type CourseResourceItem = {
  id: string;
  title: string;
  /** 이 교과목에 붙어 있으면 true. 다른 교과목 소속이면 그 이름이 `otherCourseName`에 옵니다. */
  linked: boolean;
  otherCourseName: string | null;
  updatedAt: string;
};

export type CourseResourcePage = {
  items: CourseResourceItem[];
  totalCount: number;
  page: number;
  pageSize: number;
};

export type ResourceFilter = "all" | "linked" | "unassigned";

type Query = {
  search?: string;
  page?: number;
  pageSize?: number;
  filter?: ResourceFilter;
};

function subjectFilter(subjectId: string, filter: ResourceFilter) {
  if (filter === "linked") return { subjectId };
  // "미분류"는 어느 교과목에도 안 붙은 것 + 이 교과목에 이미 붙은 것입니다. 후자를 빼면
  // 방금 붙인 항목이 목록에서 사라져 체크를 해제할 방법이 없어집니다.
  if (filter === "unassigned") return { OR: [{ subjectId: null }, { subjectId }] };
  return {};
}

export async function getCourseQuizCandidates(
  subjectId: string,
  ownerId: string,
  { search = "", page = 1, pageSize = RESOURCE_PAGE_SIZE, filter = "all" }: Query = {},
): Promise<CourseResourcePage> {
  const prisma = getPrisma();
  const safePage = Math.max(1, Math.floor(page));
  const term = search.trim();
  const where: Prisma.QuizWhereInput = {
    ownerId,
    deletedAt: null,
    ...(term ? { title: { contains: term, mode: "insensitive" } } : {}),
    ...subjectFilter(subjectId, filter),
  };
  const [totalCount, rows] = await Promise.all([
    prisma.quiz.count({ where }),
    prisma.quiz.findMany({
      where,
      orderBy: [{ updatedAt: "desc" }, { id: "asc" }],
      skip: (safePage - 1) * pageSize,
      take: pageSize,
      select: { id: true, title: true, subjectId: true, updatedAt: true, subject: { select: { name: true } } },
    }),
  ]);
  return {
    items: rows.map((row) => ({
      id: row.id,
      title: row.title,
      linked: row.subjectId === subjectId,
      otherCourseName: row.subjectId && row.subjectId !== subjectId ? row.subject?.name ?? null : null,
      updatedAt: row.updatedAt.toISOString(),
    })),
    totalCount,
    page: safePage,
    pageSize,
  };
}

export async function getCourseBoardCandidates(
  subjectId: string,
  ownerId: string,
  { search = "", page = 1, pageSize = RESOURCE_PAGE_SIZE, filter = "all" }: Query = {},
): Promise<CourseResourcePage> {
  const prisma = getPrisma();
  const safePage = Math.max(1, Math.floor(page));
  const term = search.trim();
  const where: Prisma.BoardWhereInput = {
    ownerId,
    deletedAt: null,
    ...(term ? { title: { contains: term, mode: "insensitive" } } : {}),
    ...subjectFilter(subjectId, filter),
  };
  const [totalCount, rows] = await Promise.all([
    prisma.board.count({ where }),
    prisma.board.findMany({
      where,
      orderBy: [{ updatedAt: "desc" }, { id: "asc" }],
      skip: (safePage - 1) * pageSize,
      take: pageSize,
      select: { id: true, title: true, subjectId: true, updatedAt: true, subject: { select: { name: true } } },
    }),
  ]);
  return {
    items: rows.map((row) => ({
      id: row.id,
      title: row.title,
      linked: row.subjectId === subjectId,
      otherCourseName: row.subjectId && row.subjectId !== subjectId ? row.subject?.name ?? null : null,
      updatedAt: row.updatedAt.toISOString(),
    })),
    totalCount,
    page: safePage,
    pageSize,
  };
}

export async function getCourseFormCandidates(
  subjectId: string,
  ownerId: string,
  { search = "", page = 1, pageSize = RESOURCE_PAGE_SIZE, filter = "all" }: Query = {},
): Promise<CourseResourcePage> {
  const prisma = getPrisma();
  const safePage = Math.max(1, Math.floor(page));
  const term = search.trim();
  const where: Prisma.FormWhereInput = {
    ownerId, deletedAt: null,
    ...(term ? { title: { contains: term, mode: "insensitive" } } : {}),
    ...subjectFilter(subjectId, filter),
  };
  const [totalCount, rows] = await Promise.all([
    prisma.form.count({ where }),
    prisma.form.findMany({ where, orderBy: [{ updatedAt: "desc" }, { id: "asc" }],
      skip: (safePage - 1) * pageSize, take: pageSize,
      select: { id: true, title: true, subjectId: true, updatedAt: true, subject: { select: { name: true } } },
    }),
  ]);
  return { items: rows.map(row => ({ id: row.id, title: row.title, linked: row.subjectId === subjectId,
    otherCourseName: row.subjectId && row.subjectId !== subjectId ? row.subject?.name ?? null : null,
    updatedAt: row.updatedAt.toISOString(),
  })), totalCount, page: safePage, pageSize };
}
