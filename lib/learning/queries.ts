import "server-only";

import type { Prisma } from "@/generated/prisma/client";
import type { CurrentUser } from "@/lib/auth/current-user";
import { AuthorizationError } from "@/lib/auth/authorization";
import { getPrisma } from "@/lib/prisma";
import { rosterMemberWhere } from "@/lib/subjects/roster";
import { canAssignStudentsToCourses, enrolledSubjectWhere as enrolledSubjects } from "@/lib/subjects/scope";
import { getQuizLearningPage } from "./quiz-queries";
import { formClosedReason } from "@/lib/forms/field-types";
import type { LearningCourse, LearningKind, LearningPage } from "./types";

/** 관리 컴포넌트/명단 조회보다 먼저 실행하는 서버 권한 경계. */
export async function getCourseAccess(subjectId: string, user: CurrentUser): Promise<LearningCourse | null> {
  const prisma = getPrisma();
  const course = await prisma.subject.findUnique({ where: { id: subjectId }, select: { id: true, name: true, ownerId: true } });
  if (!course) return null;
  if (course.ownerId === user.id) return { id: course.id, name: course.name, canManage: canAssignStudentsToCourses(user) };
  const member = await prisma.user.count({ where: { AND: [{ id: user.id }, rosterMemberWhere(subjectId)] } });
  return member ? { id: course.id, name: course.name, canManage: false } : null;
}

/** 학생 화면에는 명단, 관리자 후보 목록, 타인 응답을 조회하거나 직렬화하지 않습니다. */
export async function getLearningCourses(user: CurrentUser): Promise<LearningCourse[]> {
  const rows = await getPrisma().subject.findMany({
    where: { OR: [{ ownerId: user.id }, ...(user.role === "STUDENT" ? [enrolledSubjects(user.id)] : [])] },
    orderBy: [{ name: "asc" }, { id: "asc" }],
    select: { id: true, name: true, ownerId: true },
  });
  return rows.map(row => ({ id: row.id, name: row.name, canManage: row.ownerId === user.id && canAssignStudentsToCourses(user) }));
}

function positive(value: number | undefined, fallback: number, max: number) {
  return Number.isFinite(value) ? Math.max(1, Math.min(max, Math.floor(value!))) : fallback;
}

export async function getLearningPage(user: CurrentUser, options: {
  kind: LearningKind; subjectId?: string; page?: number; pageSize?: number;
}): Promise<LearningPage> {
  const { kind, subjectId } = options;
  if (subjectId && !await getCourseAccess(subjectId, user)) throw new AuthorizationError("교과목을 볼 권한이 없습니다.");
  const prisma = getPrisma();
  const pageSize = positive(options.pageSize, 24, 24);
  const requestedPage = positive(options.page, 1, 10000);
  const pagination = (total: number) => {
    const totalPages = Math.max(1, Math.ceil(total / pageSize));
    return { kind, total, page: Math.min(requestedPage, totalPages), pageSize, totalPages };
  };
  const courseSelect = { select: { name: true } } as const;

  if (kind === "quiz") return getQuizLearningPage(user, { subjectId, page: requestedPage, pageSize });

  if (kind === "pad") {
    const membership: Prisma.BoardWhereInput[] = [{ ownerId: user.id }, { members: { some: { userId: user.id } } }];
    const where: Prisma.BoardWhereInput = {
      deletedAt: null, ...(subjectId ? { subjectId } : {}),
      // 교과목은 공개 링크의 발견 경로일 뿐 PRIVATE 보드의 멤버 권한을 새로 부여하지 않습니다.
      OR: subjectId ? [...membership, { discoveryScope: "LINK" }, { discoveryScope: "PUBLIC", visitorPermission: { not: "NO_ACCESS" } }] : membership,
    };
    const paging = pagination(await prisma.board.count({ where }));
    const rows = await prisma.board.findMany({
      where, orderBy: [{ updatedAt: "desc" }, { id: "desc" }], skip: (paging.page - 1) * pageSize, take: pageSize,
      select: { id: true, title: true, description: true, slug: true, state: true, subject: courseSelect },
    });
    return { ...paging, items: rows.map(row => ({ id: row.id, title: row.title, description: row.description,
      subjectName: row.subject?.name ?? null, status: row.state === "FROZEN" ? "읽기 전용" : "참여 중",
      action: "패드 열기", href: `/b/${row.slug}`,
    })) };
  }

  const where: Prisma.FormWhereInput = {
    deletedAt: null, status: { in: ["OPEN", "CLOSED"] }, ...(subjectId ? { subjectId } : {}),
    OR: [{ subject: { is: enrolledSubjects(user.id) } }, { responses: { some: { respondentId: user.id } } }],
  };
  const paging = pagination(await prisma.form.count({ where }));
  const rows = await prisma.form.findMany({
    where, orderBy: [{ updatedAt: "desc" }, { id: "desc" }], skip: (paging.page - 1) * pageSize, take: pageSize,
    select: { id: true, title: true, description: true, slug: true, status: true, subject: courseSelect,
      openAt: true, closeAt: true, maxResponses: true, responseCount: true,
      responses: { where: { respondentId: user.id }, take: 1, select: { id: true } },
    },
  });
  return { ...paging, items: rows.map(row => {
    const closed = formClosedReason(row);
    return { id: row.id, title: row.title, description: row.description, subjectName: row.subject?.name ?? null,
      status: row.responses.length ? "제출 완료" : closed === "NOT_OPEN_YET" ? "시작 전" : closed ? "마감" : "응답 가능",
      action: row.responses.length ? "제출 상태 확인" : closed ? "설문 안내" : "설문 응답", href: `/s/${row.slug}`,
    };
  }) };
}
