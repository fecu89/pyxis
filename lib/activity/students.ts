import "server-only";

import type { FormFieldType, Prisma } from "@/generated/prisma/client";
import { hasSystemPermission } from "@/lib/auth/permissions";
import type { CurrentUser } from "@/lib/auth/current-user";
import { boardPostRoutePath } from "@/lib/board/route-paths";
import { formatAnswerValue } from "@/lib/forms/answer-format";
import { getPrisma } from "@/lib/prisma";
import { decryptUserLoginIdentifier, toPublicAuthorDTO } from "@/lib/users/repository";
import { searchActiveStudents } from "@/lib/users/student-search";

// `/report/students` 목록의 조회 계층입니다. 학생을 고르면 그 학생의 퀴즈·패드 기록
// (`/report/students/[studentId]`)으로 들어갑니다.

export const REPORT_STUDENT_PAGE_SIZE = 30;
const STUDENT_POST_HISTORY_LIMIT = 50;
const STUDENT_FORM_HISTORY_LIMIT = 50;

export type ReportStudentRow = {
  id: string;
  name: string;
  schoolGroupName: string | null;
  quizCount: number;
  postCount: number;
  formResponseCount: number;
};

export type ReportSchoolGroupOption = {
  id: string;
  label: string;
};

export type StudentPadPostHistoryEntry = {
  id: string;
  href: string;
  title: string;
  body: string;
  status: "PENDING" | "PUBLISHED" | "REJECTED";
  moderationReason: string | null;
  boardTitle: string;
  sectionTitle: string | null;
  createdAt: Date;
  updatedAt: Date;
  attachmentCount: number;
  commentCount: number;
  reactionCount: number;
};

export type StudentFormResponseAnswer = {
  fieldId: string;
  fieldType: FormFieldType;
  fieldTitle: string;
  value: string;
};

export type StudentFormResponseHistoryEntry = {
  id: string;
  formId: string;
  formTitle: string;
  submittedAt: Date | null;
  answers: StudentFormResponseAnswer[];
};

/**
 * 볼 수 있는 학생의 범위. `lib/activity/report.ts`의 `scopeFor`와 같은 규칙입니다 —
 * 목록에 보이는 학생은 상세도 열려야 하고, 그 반대도 마찬가지입니다.
 */
function scopeFor(user: CurrentUser): Prisma.UserWhereInput {
  if (user.role === "SUPER_ADMIN"
    || hasSystemPermission(user, "VIEW_ALL_BOARDS")
    || hasSystemPermission(user, "VIEW_ALL_QUIZZES")) {
    return {};
  }
  if (user.role === "TEACHER" && user.school) return { schoolId: user.school.id };
  // 학생과 소속 없는 교사는 자기 자신만 봅니다.
  return { id: user.id };
}

export async function getReportStudentPage(
  user: CurrentUser,
  options: { page?: number; query?: string; schoolGroupId?: string } = {},
) {
  const page = Math.max(1, Math.floor(options.page ?? 1));
  const query = options.query?.trim() ?? "";
  const prisma = getPrisma();
  const scope = scopeFor(user);

  // 이름·아이디는 암호화되어 있으므로 교과목 명단과 같은 제한형 복호화 검색을 사용합니다.
  // 학급·학교 조건으로 먼저 범위를 좁힌 뒤 최대 600명만 훑어 부분 검색합니다.
  const where: Prisma.UserWhereInput = {
    role: "STUDENT" as const,
    status: "ACTIVE" as const,
    registrationApprovalStatus: "APPROVED" as const,
    ...scope,
    ...(options.schoolGroupId ? { schoolGroupId: options.schoolGroupId } : {}),
  };

  const [searchResult, groups] = await Promise.all([
    searchActiveStudents({ where, search: query, page, pageSize: REPORT_STUDENT_PAGE_SIZE }),
    prisma.schoolGroup.findMany({
      where: {
        type: "CLASS",
        users: { some: { role: "STUDENT", status: "ACTIVE", registrationApprovalStatus: "APPROVED", ...scope } },
      },
      orderBy: [{ schoolId: "asc" }, { gradeId: "asc" }, { classNumber: "asc" }, { name: "asc" }],
      select: { id: true, name: true, school: { select: { name: true } } },
    }),
  ]);
  const visibleIds = searchResult.students.map((student) => student.id);
  const rows = visibleIds.length
    ? await prisma.user.findMany({
      where: { id: { in: visibleIds } },
      select: {
        id: true, nameEncrypted: true, imageEncrypted: true, loginIdentifierEncrypted: true,
        schoolGroup: { select: { name: true } },
        _count: {
          select: {
            participations: true,
            posts: { where: { deletedAt: null, board: { deletedAt: null } } },
            formResponses: { where: { status: "SUBMITTED", form: { deletedAt: null } } },
          },
        },
      },
    })
    : [];
  const rowById = new Map(rows.map((row) => [row.id, row]));

  const students: ReportStudentRow[] = visibleIds.flatMap((id) => {
    const row = rowById.get(id);
    return row ? [{
      id: row.id,
      name: toPublicAuthorDTO(row).name ?? decryptUserLoginIdentifier(row) ?? "학생",
      schoolGroupName: row.schoolGroup?.name ?? null,
      quizCount: row._count.participations,
      postCount: row._count.posts,
      formResponseCount: row._count.formResponses,
    }] : [];
  });

  const showSchoolName = user.role === "SUPER_ADMIN"
    || hasSystemPermission(user, "VIEW_ALL_BOARDS")
    || hasSystemPermission(user, "VIEW_ALL_QUIZZES");
  const schoolGroups: ReportSchoolGroupOption[] = groups.map((group) => ({
    id: group.id,
    label: showSchoolName ? `${group.school.name} · ${group.name}` : group.name,
  }));

  return {
    students,
    schoolGroups,
    total: searchResult.totalCount,
    page: searchResult.page,
    pageSize: REPORT_STUDENT_PAGE_SIZE,
    searchTruncated: searchResult.truncated,
  };
}

/** 학생이 실제로 작성한 삭제되지 않은 패드 글을 최근 순으로 돌려줍니다. */
export async function getStudentPadPostHistory(userId: string): Promise<StudentPadPostHistoryEntry[]> {
  const posts = await getPrisma().post.findMany({
    where: { authorId: userId, deletedAt: null, board: { deletedAt: null } },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    take: STUDENT_POST_HISTORY_LIMIT,
    select: {
      id: true,
      title: true,
      body: true,
      status: true,
      moderationReason: true,
      createdAt: true,
      updatedAt: true,
      board: { select: { slug: true, title: true } },
      section: { select: { title: true } },
      _count: {
        select: {
          attachments: { where: { commentId: null, deletedAt: null } },
          comments: { where: { deletedAt: null } },
          reactions: true,
        },
      },
    },
  });

  return posts.map((post) => ({
    id: post.id,
    href: boardPostRoutePath(post.board.slug, post.id),
    title: post.title?.trim() || "제목 없는 글",
    body: post.body.trim(),
    status: post.status,
    moderationReason: post.moderationReason,
    boardTitle: post.board.title,
    sectionTitle: post.section?.title ?? null,
    createdAt: post.createdAt,
    updatedAt: post.updatedAt,
    attachmentCount: post._count.attachments,
    commentCount: post._count.comments,
    reactionCount: post._count.reactions,
  }));
}

/** 로그인 상태로 제출한 설문의 문항·답변 스냅샷을 최근 순으로 돌려줍니다. */
export async function getStudentFormResponseHistory(userId: string): Promise<StudentFormResponseHistoryEntry[]> {
  const responses = await getPrisma().formResponse.findMany({
    where: { respondentId: userId, status: "SUBMITTED", form: { deletedAt: null } },
    orderBy: [{ submittedAt: "desc" }, { id: "desc" }],
    take: STUDENT_FORM_HISTORY_LIMIT,
    select: {
      id: true,
      submittedAt: true,
      form: { select: { id: true, title: true } },
      answers: {
        orderBy: { answeredAt: "asc" },
        select: {
          fieldId: true,
          fieldType: true,
          fieldTitle: true,
          textValue: true,
          selectedOptionTexts: true,
          numberValue: true,
          dateValue: true,
          timeValue: true,
          gridValue: true,
          files: { where: { deletedAt: null }, select: { originalName: true } },
        },
      },
    },
  });

  return responses.map((response) => ({
    id: response.id,
    formId: response.form.id,
    formTitle: response.form.title || "제목 없는 설문지",
    submittedAt: response.submittedAt,
    answers: response.answers.map((answer) => ({
      fieldId: answer.fieldId,
      fieldType: answer.fieldType,
      fieldTitle: answer.fieldTitle,
      value: formatAnswerValue({
        ...answer,
        dateValue: answer.dateValue?.toISOString() ?? null,
      }),
    })),
  }));
}
