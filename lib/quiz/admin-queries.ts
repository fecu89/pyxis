import "server-only";

import { getPrisma } from "@/lib/prisma";
import { toPublicAuthorDTO } from "@/lib/users/repository";

// 관리자 센터 "전체 퀴즈" 탭 전용입니다. `lib/quiz/library-page.ts`의 getQuizLibraryPage는
// 본인 서재용(즐겨찾기·배정·과목 사이드바까지 함께 계산)이라 목적이 다르고, 이 화면은
// lib/board/queries.ts의 getAdminBoardPage처럼 진짜 skip/take + count 페이지네이션만 필요합니다.
export async function getAdminQuizPage({ page, pageSize, search, includeArchived, ownerLoginIdentifierLookup, updatedFrom, updatedTo, sortBy = "updatedAt", sortDir = "desc" }: {
  page: number;
  pageSize: number;
  search?: string;
  includeArchived: boolean;
  ownerLoginIdentifierLookup?: string;
  updatedFrom?: Date;
  updatedTo?: Date;
  sortBy?: "title" | "updatedAt" | "questions" | "sessions";
  sortDir?: "asc" | "desc";
}) {
  const prisma = getPrisma();
  const where = {
    deletedAt: includeArchived ? { not: null } : null,
    ...(search ? { title: { contains: search, mode: "insensitive" as const } } : {}),
    ...(ownerLoginIdentifierLookup ? { owner: { loginIdentifierLookup: ownerLoginIdentifierLookup } } : {}),
    ...((updatedFrom || updatedTo) ? { updatedAt: { ...(updatedFrom ? { gte: updatedFrom } : {}), ...(updatedTo ? { lte: updatedTo } : {}) } } : {}),
  };
  // 보관된 퀴즈를 볼 때는 항상 보관일(deletedAt) 기준으로 정렬합니다 — getAdminBoardPage와 같은 이유입니다.
  const orderBy = includeArchived
    ? { deletedAt: sortDir }
    : sortBy === "title" ? { title: sortDir }
      : sortBy === "questions" ? { questions: { _count: sortDir } }
        : sortBy === "sessions" ? { sessions: { _count: sortDir } }
          : { updatedAt: sortDir };
  const [totalCount, quizzes] = await Promise.all([
    prisma.quiz.count({ where }),
    prisma.quiz.findMany({
      where,
      orderBy,
      skip: (page - 1) * pageSize,
      take: pageSize,
      select: {
        id: true,
        title: true,
        isPublished: true,
        requiresLogin: true,
        updatedAt: true,
        deletedAt: true,
        frozenAt: true,
        owner: { select: { id: true, role: true, nameEncrypted: true, imageEncrypted: true } },
        _count: { select: { questions: true, sessions: true } },
      },
    }),
  ]);
  return {
    quizzes: quizzes.map((quiz) => ({
      id: quiz.id,
      title: quiz.title,
      isPublished: quiz.isPublished,
      requiresLogin: quiz.requiresLogin,
      updatedAt: quiz.updatedAt.toISOString(),
      deletedAt: quiz.deletedAt ? quiz.deletedAt.toISOString() : null,
      frozen: quiz.frozenAt !== null,
      owner: toPublicAuthorDTO(quiz.owner),
      ownerRole: quiz.owner.role,
      _count: quiz._count,
    })),
    totalCount,
    page,
    pageSize,
  };
}
