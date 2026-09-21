import "server-only";

import type { Prisma } from "@/generated/prisma/client";
import type { CurrentUser } from "@/lib/auth/current-user";
import { hasSystemPermission } from "@/lib/auth/authorization";
import { getPrisma } from "@/lib/prisma";
import { searchActiveStudents, type StudentSearchPage } from "@/lib/users/student-search";

/**
 * 퀴즈를 학생에게 할당하는 화면의 학생·학급 후보 조회.
 *
 * 학생 범위 판정(`assignableStudentWhere`)은 원래 `studentScope`라는 이름으로
 * `app/api/quiz/quizzes/[quizId]/assignments/route.ts` 안에만 있었습니다. GET(후보 조회)과
 * POST(할당 확정)이 "누구를 고를 수 있는가"를 각자 판정하면, 한쪽만 고쳤을 때 후보 목록에는
 * 안 보이는 학생을 ID로 지정해 할당할 수 있는 구멍이 생깁니다. 그래서 판정을 이 lib로
 * 옮겨 두 라우트가 같은 함수를 부르게 합니다.
 */
export const ASSIGN_PAGE_SIZE = 50;

export type AssignClassOption = {
  id: string;
  name: string;
  gradeName: string | null;
  studentCount: number;
};

/** 범위가 전체면 null, 학교가 있으면 그 학교 ID, 무소속이면 실존하지 않는 자리표시자입니다. */
function assignScopeSchoolId(actor: CurrentUser): string | null {
  if (hasSystemPermission(actor, "VIEW_USERS")) return null;
  return actor.school?.id ?? "__no_school__";
}

/** 할당 대상 학생의 범위. 권한 있는 관리자는 전체, 그 외 교사는 자기 학교만 다룹니다. */
export function assignableStudentWhere(actor: CurrentUser): Prisma.UserWhereInput {
  const schoolId = assignScopeSchoolId(actor);
  if (schoolId === null) return {};
  if (schoolId === "__no_school__") return { id: "__no_school__" };
  return { schoolId };
}

/**
 * 범위 학교의 학급(CLASS) 목록입니다. 필터 드롭다운용이라 `lib/subjects/roster.ts`의
 * `getLinkableSchoolGroups`와 같은 정렬·상한을 씁니다. `AssignClassOption`에는 학교 이름을
 * 담지 않습니다 — 이 화면은 이미 교사의 학교 범위로 좁혀진 채 열리므로 필터 라벨은 학년+반
 * 이름만으로 고정된 프론트 계약입니다.
 */
export async function getAssignableClassGroups(actor: CurrentUser): Promise<AssignClassOption[]> {
  const schoolId = assignScopeSchoolId(actor);
  const groups = await getPrisma().schoolGroup.findMany({
    where: {
      type: "CLASS",
      ...(schoolId === null ? {} : { schoolId }),
    },
    orderBy: [{ schoolId: "asc" }, { gradeId: "asc" }, { classNumber: "asc" }, { name: "asc" }],
    take: 300,
    select: {
      id: true,
      name: true,
      grade: { select: { grade: true } },
      _count: { select: { users: { where: { role: "STUDENT", status: "ACTIVE" } } } },
    },
  });
  return groups.map((group) => ({
    id: group.id,
    name: group.name,
    gradeName: group.grade ? `${group.grade.grade}학년` : null,
    studentCount: group._count.users,
  }));
}

export type AssignCandidateQuery = {
  search?: string;
  schoolGroupId?: string;
  page?: number;
  pageSize?: number;
};

/**
 * 퀴즈에 할당할 수 있는 학생 후보입니다. 검색·페이지네이션은
 * `lib/users/student-search.ts`의 `searchActiveStudents`에 위임하고, 여기서는 역할·상태·
 * 학교 범위·학급 필터만 조립합니다.
 *
 * `schoolGroupId`가 교사의 학교 범위 밖(다른 학교의 반)이면 `assignableStudentWhere`가 만든
 * 학교 조건과 AND로 묶여 자동으로 빈 결과가 됩니다 — 반 ID를 알아내도 다른 학교 학생을
 * 훑어볼 수 없습니다.
 */
export async function getAssignableStudentCandidates(
  actor: CurrentUser,
  { search, schoolGroupId, page, pageSize = ASSIGN_PAGE_SIZE }: AssignCandidateQuery = {},
): Promise<StudentSearchPage> {
  return searchActiveStudents({
    where: {
      role: "STUDENT",
      status: "ACTIVE",
      ...assignableStudentWhere(actor),
      ...(schoolGroupId ? { schoolGroupId } : {}),
    },
    search,
    page,
    pageSize,
  });
}
