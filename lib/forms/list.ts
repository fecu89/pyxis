import "server-only";

import { Prisma } from "@/generated/prisma/client";
import { canViewAllQuizzes, type AuthorizationUser } from "@/lib/auth/authorization";
import { type FormListView } from "@/lib/forms/navigation";
import { getPrisma } from "@/lib/prisma";
import { resolveFormAccessLevel, type FormAccessLevel } from "@/lib/forms/access-level";
import { toPublicAuthorDTO } from "@/lib/users/repository";

export const FORM_LIST_PAGE_SIZE = 20;

export type FormListParams = {
  view: FormListView;
  page: number;
  query: string;
  sort: "UPDATED" | "TITLE" | "RESPONSES";
};

export type FormListItem = {
  id: string;
  title: string;
  description: string | null;
  status: "DRAFT" | "OPEN" | "CLOSED";
  slug: string;
  requiresLogin: boolean;
  updatedAt: string;
  accessLevel: FormAccessLevel;
  frozen: boolean;
  ownerName: string | null;
  subject: { id: string; name: string } | null;
  _count: { fields: number; responses: number };
};

export function parseFormListParams(input: Record<string, string | string[] | undefined>, view: FormListView = "ALL"): FormListParams {
  const one = (value: string | string[] | undefined) => Array.isArray(value) ? value[0] : value;
  const rawPage = Array.isArray(input.page) ? input.page[0] : input.page;
  const parsedPage = Number(rawPage);
  const page = Number.isSafeInteger(parsedPage) && parsedPage > 0 ? parsedPage : 1;
  const query = (one(input.q) ?? "").trim().slice(0, 80);
  const sortValue = one(input.sort);
  const sort = sortValue === "TITLE" || sortValue === "RESPONSES" ? sortValue : "UPDATED";
  return { view, page, query, sort };
}

function whereFor(view: FormListView, actorId: string, seeAll: boolean, query = ""): Prisma.FormWhereInput {
  const scope: Prisma.FormWhereInput = seeAll
    ? {}
    : { OR: [{ ownerId: actorId }, { shares: { some: { userId: actorId } } }] };
  const status = view === "ALL" ? {} : { status: view };
  const search: Prisma.FormWhereInput = query ? { OR: [
    { title: { contains: query, mode: "insensitive" } },
    { description: { contains: query, mode: "insensitive" } },
    { subject: { is: { name: { contains: query, mode: "insensitive" } } } },
  ] } : {};
  return { AND: [{ deletedAt: null }, scope, status, search] };
}

/** `/forms`의 서버 렌더링용 목록과 사이드바 상태별 개수를 함께 읽습니다. */
export async function getFormListPage(actor: AuthorizationUser, params: FormListParams) {
  const prisma = getPrisma();
  // 설문에는 별도의 조회 권한이 없어 퀴즈의 "전체 조회" 판정(VIEW_ALL_QUIZZES 또는
  // EDIT_ANY_QUIZ)을 그대로 씁니다 — admin "전체 설문" 탭(app/api/admin/forms/route.ts)과
  // 같은 함수라 두 화면의 조회 범위가 갈리지 않습니다.
  const seeAll = canViewAllQuizzes(actor);
  const allWhere = whereFor("ALL", actor.id, seeAll);
  const listWhere = whereFor(params.view, actor.id, seeAll, params.query);
  const [groupedCounts, total] = await Promise.all([
    prisma.form.groupBy({ by: ["status"], where: allWhere, _count: { _all: true } }),
    prisma.form.count({ where: listWhere }),
  ]);
  const counts = {
    ALL: groupedCounts.reduce((sum, row) => sum + row._count._all, 0),
    OPEN: groupedCounts.find((row) => row.status === "OPEN")?._count._all ?? 0,
    DRAFT: groupedCounts.find((row) => row.status === "DRAFT")?._count._all ?? 0,
    CLOSED: groupedCounts.find((row) => row.status === "CLOSED")?._count._all ?? 0,
  };
  const totalPages = Math.max(1, Math.ceil(total / FORM_LIST_PAGE_SIZE));
  const page = Math.min(params.page, totalPages);
  const orderBy: Prisma.FormOrderByWithRelationInput[] = params.sort === "TITLE"
    ? [{ title: "asc" }, { id: "asc" }]
    : params.sort === "RESPONSES"
      ? [{ responses: { _count: "desc" } }, { updatedAt: "desc" }, { id: "asc" }]
      : [{ updatedAt: "desc" }, { id: "desc" }];
  const rows = await prisma.form.findMany({
    where: listWhere,
    orderBy,
    skip: (page - 1) * FORM_LIST_PAGE_SIZE,
    take: FORM_LIST_PAGE_SIZE,
    select: {
      id: true,
      title: true,
      description: true,
      status: true,
      slug: true,
      requiresLogin: true,
      updatedAt: true,
      ownerId: true,
      frozenAt: true,
      owner: { select: { id: true, nameEncrypted: true, imageEncrypted: true } },
      shares: { where: { userId: actor.id }, select: { permission: true } },
      subject: { select: { id: true, name: true } },
      _count: { select: { fields: true, responses: true } },
    },
  });

  return {
    items: rows.flatMap((row) => {
      const accessLevel = resolveFormAccessLevel(row, actor);
      return accessLevel ? [{
        id: row.id, title: row.title, description: row.description, status: row.status,
        slug: row.slug, requiresLogin: row.requiresLogin, updatedAt: row.updatedAt.toISOString(),
        subject: row.subject, _count: row._count, accessLevel,
        frozen: Boolean(row.frozenAt), ownerName: toPublicAuthorDTO(row.owner).name,
      }] : [];
    }) satisfies FormListItem[],
    counts,
    total,
    page,
    pageSize: FORM_LIST_PAGE_SIZE,
    totalPages,
  };
}
