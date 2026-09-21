import "server-only";

import { getPrisma } from "@/lib/prisma";
import { toPublicAuthorDTO } from "@/lib/users/repository";

// 관리자 센터 "전체 설문" 탭 전용입니다. lib/forms/list.ts의 getFormListPage는 본인 서재용
// (/forms, view·status 필터·상태별 사이드바 카운트)이라 목적이 다르고, 이 화면은
// lib/quiz/admin-queries.ts의 getAdminQuizPage처럼 진짜 skip/take + count 페이지네이션만 필요합니다.
export async function getAdminFormPage({ page, pageSize, search, includeArchived, ownerLoginIdentifierLookup, updatedFrom, updatedTo, sortBy = "updatedAt", sortDir = "desc" }: {
  page: number;
  pageSize: number;
  search?: string;
  includeArchived: boolean;
  ownerLoginIdentifierLookup?: string;
  updatedFrom?: Date;
  updatedTo?: Date;
  sortBy?: "title" | "updatedAt" | "fields" | "responses";
  sortDir?: "asc" | "desc";
}) {
  const prisma = getPrisma();
  const where = {
    deletedAt: includeArchived ? { not: null } : null,
    ...(search ? { title: { contains: search, mode: "insensitive" as const } } : {}),
    ...(ownerLoginIdentifierLookup ? { owner: { loginIdentifierLookup: ownerLoginIdentifierLookup } } : {}),
    ...((updatedFrom || updatedTo) ? { updatedAt: { ...(updatedFrom ? { gte: updatedFrom } : {}), ...(updatedTo ? { lte: updatedTo } : {}) } } : {}),
  };
  // 보관된 설문을 볼 때는 항상 보관일(deletedAt) 기준으로 정렬합니다 — getAdminQuizPage와 같은 이유입니다.
  const orderBy = includeArchived
    ? { deletedAt: sortDir }
    : sortBy === "title" ? { title: sortDir }
      : sortBy === "fields" ? { fields: { _count: sortDir } }
        : sortBy === "responses" ? { responses: { _count: sortDir } }
          : { updatedAt: sortDir };
  const [totalCount, forms] = await Promise.all([
    prisma.form.count({ where }),
    prisma.form.findMany({
      where,
      orderBy,
      skip: (page - 1) * pageSize,
      take: pageSize,
      select: {
        id: true,
        title: true,
        status: true,
        requiresLogin: true,
        slug: true,
        updatedAt: true,
        deletedAt: true,
        frozenAt: true,
        owner: { select: { id: true, role: true, nameEncrypted: true, imageEncrypted: true } },
        _count: { select: { fields: true, responses: true } },
      },
    }),
  ]);
  return {
    forms: forms.map((form) => ({
      id: form.id,
      title: form.title,
      status: form.status,
      requiresLogin: form.requiresLogin,
      slug: form.slug,
      updatedAt: form.updatedAt.toISOString(),
      deletedAt: form.deletedAt ? form.deletedAt.toISOString() : null,
      frozen: form.frozenAt !== null,
      owner: toPublicAuthorDTO(form.owner),
      ownerRole: form.owner.role,
      _count: form._count,
    })),
    totalCount,
    page,
    pageSize,
  };
}
