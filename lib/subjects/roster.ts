import "server-only";

import type { Prisma } from "@/generated/prisma/client";
import type { CurrentUser } from "@/lib/auth/current-user";
import { getPrisma } from "@/lib/prisma";
import { decryptUserLoginIdentifier, toPublicAuthorDTO } from "@/lib/users/repository";
import { searchActiveStudents } from "@/lib/users/student-search";
import { courseScopeSchoolId, eligibleCourseStudentWhere } from "@/lib/subjects/scope";

/**
 * 교과목의 실제 명단은 **두 축의 합집합**입니다.
 *
 *   개별 배정(SubjectStudent)  ∪  연결된 학급(SubjectSchoolGroup)의 활성 학생
 *
 * 400명 규모에서 반 하나를 넣으려고 체크박스를 28번 누르는 건 쓸 수 없고, 반대로 "이 반에서
 * 3명만 빼고" 같은 예외도 실제로 생기기 때문에 둘 다 필요합니다. 학급 쪽은 살아 있는 연결이라
 * 전학·반 이동이 자동으로 반영되고, 그 순간 명단을 고정하고 싶으면 UI의 "명단만 복사"가
 * 연결 대신 개별 배정 행을 만들어 줍니다.
 *
 * 한 학생이 양쪽에 모두 걸릴 수 있으므로(개별 배정 + 그 학생의 반도 연결됨) 계산은 항상
 * 합집합이고, DTO의 `sources`가 어느 경로로 들어왔는지 알려 줍니다 — 화면에서 "이 학생은
 * 반 연결로 들어와서 개별 제거가 안 된다"를 설명해야 하기 때문입니다.
 */
export const ROSTER_PAGE_SIZE = 50;

export type RosterSource = "DIRECT" | "GROUP";

export type RosterStudent = {
  id: string;
  name: string | null;
  loginId: string | null;
  studentNumber: number | null;
  className: string | null;
  gradeName: string | null;
  sources: RosterSource[];
};

export type RosterPage = {
  students: RosterStudent[];
  totalCount: number;
  page: number;
  pageSize: number;
};

export type CourseRosterData = RosterPage & {
  groups: CourseGroupLink[];
  linkableGroups: CourseGroupLink[];
};

/** 교과목 명단에 드는 학생의 조건. 개별 배정이거나, 연결된 학급에 속하거나. */
export function rosterMemberWhere(subjectId: string): Prisma.UserWhereInput {
  return {
    role: "STUDENT",
    status: "ACTIVE",
    OR: [
      { subjectMemberships: { some: { subjectId } } },
      { schoolGroup: { subjectLinks: { some: { subjectId } } } },
    ],
  };
}

// 이름은 암호화 필드라 DB에서 정렬·검색할 수 없습니다. 그래서 정렬은 학급 → 출석번호로 하고
// (교사가 실제로 명단을 읽는 순서이기도 합니다), 검색은 아래 `searchRoster`가 담당합니다.
const ROSTER_ORDER: Prisma.UserOrderByWithRelationInput[] = [
  { schoolGroupId: "asc" },
  { studentNumber: "asc" },
  { createdAt: "asc" },
];

const ROSTER_SELECT = {
  id: true,
  loginIdentifierEncrypted: true,
  nameEncrypted: true,
  imageEncrypted: true,
  studentNumber: true,
  schoolGroup: { select: { name: true, grade: { select: { grade: true } } } },
} as const;

type RosterRow = Prisma.UserGetPayload<{ select: typeof ROSTER_SELECT }>;

function toRosterStudent(row: RosterRow, sources: RosterSource[]): RosterStudent {
  return {
    id: row.id,
    name: toPublicAuthorDTO(row).name,
    loginId: decryptUserLoginIdentifier(row),
    studentNumber: row.studentNumber,
    className: row.schoolGroup?.name ?? null,
    gradeName: row.schoolGroup?.grade ? `${row.schoolGroup.grade.grade}학년` : null,
    sources,
  };
}

/**
 * 교과목에 실제로 속한 학생을 페이지 단위로 읽습니다.
 *
 * 예전에는 학교 전체 학생 500명을 통째로 내려보내고 클라이언트가 체크박스로 들고 있었는데,
 * 400명이면 매 요청마다 400명분 복호화가 돌고 교과목 10개면 체크박스 4,000개가 DOM에
 * 올라갑니다. 이제 명단은 이 함수로만 읽고 한 번에 50명씩 가져옵니다.
 */
export async function getCourseRoster(
  subjectId: string,
  { page = 1, pageSize = ROSTER_PAGE_SIZE }: { page?: number; pageSize?: number } = {},
): Promise<RosterPage> {
  const prisma = getPrisma();
  const safePage = Math.max(1, Math.floor(page));
  const where = rosterMemberWhere(subjectId);

  const [totalCount, rows, directIds] = await Promise.all([
    prisma.user.count({ where }),
    prisma.user.findMany({
      where,
      orderBy: ROSTER_ORDER,
      skip: (safePage - 1) * pageSize,
      take: pageSize,
      select: ROSTER_SELECT,
    }),
    // 이 페이지의 학생이 개별 배정인지 판정하려고 개별 배정 ID만 따로 읽습니다. 행마다
    // 관계를 include하면 페이지당 N번 조회가 되고, 개별 배정은 보통 명단보다 훨씬 작습니다.
    prisma.subjectStudent.findMany({ where: { subjectId }, select: { studentId: true } }),
  ]);

  const direct = new Set(directIds.map(({ studentId }) => studentId));
  return {
    students: rows.map((row) => {
      const sources: RosterSource[] = [];
      if (direct.has(row.id)) sources.push("DIRECT");
      // 개별 배정이 아닌데 명단에 들었다면 반드시 학급 연결로 들어온 것입니다. 개별 배정이면서
      // 반도 연결된 경우를 구분하려면 학급 목록을 한 번 더 읽어야 하는데, 화면이 필요로 하는
      // 건 "개별 제거가 가능한가"뿐이라 그 비용을 들이지 않습니다.
      if (!direct.has(row.id)) sources.push("GROUP");
      return toRosterStudent(row, sources);
    }),
    totalCount,
    page: safePage,
    pageSize,
  };
}

export type CandidateQuery = {
  search?: string;
  schoolGroupId?: string;
  page?: number;
  pageSize?: number;
};

export type CandidatePage = RosterPage & { truncated: boolean };

/**
 * 교과목에 **추가할 수 있는** 학생 후보입니다. 이미 명단에 든 학생은 빼고, 교사의 학교
 * 범위 안에서만 찾습니다.
 *
 * 이름·아이디가 암호화 필드라 DB가 `LIKE` 검색을 못 하는 문제와 그 우회(학급·출석번호처럼
 * DB가 걸러 줄 수 있는 조건으로 먼저 좁히고, 남은 후보를 복호화해 메모리에서 거르는 스캔
 * 검색)는 `lib/users/student-search.ts`의 `searchActiveStudents`로 옮겼습니다 — 퀴즈 할당
 * 후보 조회(`lib/quiz/assign-candidates.ts`)도 같은 검색이 필요해졌기 때문입니다. 복호화
 * 상한은 그쪽의 `STUDENT_SEARCH_SCAN_LIMIT`이 정하고, 여기서는 "이미 명단에 든 학생 제외"라는
 * 교과목 전용 조건만 `where`에 얹어 위임합니다.
 */
export async function getCourseStudentCandidates(
  subjectId: string,
  actor: CurrentUser,
  { search = "", schoolGroupId, page = 1, pageSize = ROSTER_PAGE_SIZE }: CandidateQuery = {},
): Promise<CandidatePage> {
  const where: Prisma.UserWhereInput = {
    role: "STUDENT",
    status: "ACTIVE",
    ...eligibleCourseStudentWhere(actor),
    ...(schoolGroupId ? { schoolGroupId } : {}),
    // 이미 명단에 든 학생은 후보에서 뺍니다(개별 배정이든 학급 연결이든).
    NOT: rosterMemberWhere(subjectId),
  };
  const result = await searchActiveStudents({ where, search, page, pageSize });
  return {
    ...result,
    // StudentSearchHit에는 sources가 없습니다 — 후보는 정의상 아직 명단에 없는 학생이라
    // where의 NOT 조건이 이미 "직접·학급 배정 전부 아님"을 보장합니다.
    students: result.students.map((student) => ({ ...student, sources: [] })),
  };
}

export type CourseGroupLink = {
  id: string;
  name: string;
  gradeName: string | null;
  schoolName: string | null;
  studentCount: number;
};

/** 교과목에 연결된 학급과 각 반의 현재 활성 학생 수입니다. */
export async function getCourseGroupLinks(subjectId: string): Promise<CourseGroupLink[]> {
  const links = await getPrisma().subjectSchoolGroup.findMany({
    where: { subjectId },
    select: {
      schoolGroup: {
        select: {
          id: true,
          name: true,
          grade: { select: { grade: true } },
          school: { select: { name: true } },
          _count: { select: { users: { where: { role: "STUDENT", status: "ACTIVE" } } } },
        },
      },
    },
  });
  return links
    .map(({ schoolGroup }) => ({
      id: schoolGroup.id,
      name: schoolGroup.name,
      gradeName: schoolGroup.grade ? `${schoolGroup.grade.grade}학년` : null,
      schoolName: schoolGroup.school?.name ?? null,
      studentCount: schoolGroup._count.users,
    }))
    .sort((left, right) => `${left.gradeName ?? ""}${left.name}`.localeCompare(`${right.gradeName ?? ""}${right.name}`, "ko"));
}

/** 연결할 수 있는 학급 후보. 교사의 학교 범위 안의 CLASS 그룹 중 아직 연결 안 된 것. */
export async function getLinkableSchoolGroups(subjectId: string, actor: CurrentUser): Promise<CourseGroupLink[]> {
  const schoolId = courseScopeSchoolId(actor);
  const groups = await getPrisma().schoolGroup.findMany({
    where: {
      type: "CLASS",
      ...(schoolId === null ? {} : { schoolId }),
      subjectLinks: { none: { subjectId } },
    },
    orderBy: [{ schoolId: "asc" }, { gradeId: "asc" }, { classNumber: "asc" }, { name: "asc" }],
    take: 300,
    select: {
      id: true,
      name: true,
      grade: { select: { grade: true } },
      school: { select: { name: true } },
      _count: { select: { users: { where: { role: "STUDENT", status: "ACTIVE" } } } },
    },
  });
  return groups.map((group) => ({
    id: group.id,
    name: group.name,
    gradeName: group.grade ? `${group.grade.grade}학년` : null,
    schoolName: group.school?.name ?? null,
    studentCount: group._count.users,
  }));
}

export async function getCourseRosterData(subjectId: string, actor: CurrentUser, editable: boolean): Promise<CourseRosterData> {
  const [roster, groups, linkableGroups] = await Promise.all([
    getCourseRoster(subjectId, { page: 1, pageSize: ROSTER_PAGE_SIZE }),
    getCourseGroupLinks(subjectId),
    editable ? getLinkableSchoolGroups(subjectId, actor) : Promise.resolve([]),
  ]);
  return { ...roster, groups, linkableGroups };
}
