import "server-only";

import { cache } from "react";

import type { CurrentUser } from "@/lib/auth/current-user";
import { getPrisma } from "@/lib/prisma";
import { toPublicAuthorDTO } from "@/lib/users/repository";
import { canAssignStudentsToCourses } from "@/lib/subjects/scope";
import { rosterMemberWhere } from "@/lib/subjects/roster";
import { COURSE_LIST_PATH } from "@/lib/route-paths";

// 범위 판정은 lib/subjects/scope.ts가 정본입니다. 예전 import 경로를 쓰는 코드가 있어 다시 내보냅니다.
export { canAssignStudentsToCourses, eligibleCourseStudentWhere, courseScopeSchoolId } from "@/lib/subjects/scope";

export type CourseSummary = {
  id: string;
  /** 상세 화면 링크. 클라이언트가 경로를 조립하려면 라우트 매니페스트가 필요한데, 그걸
   *  번들에 넣지 않는 게 이 구조의 요점이라 서버가 만들어 실어 보냅니다. */
  href: string;
  name: string;
  quizCount: number;
  boardCount: number;
  formCount: number;
  /** 개별 배정 + 연결 학급을 합친 **실제** 학생 수입니다. */
  studentCount: number;
  /** 연결된 학급 수. 0이면 개별 배정만으로 이루어진 교과목입니다. */
  groupCount: number;
  ownerName?: string | null;
  editable: boolean;
};

export type CourseDashboardData = {
  canManage: boolean;
  canAssignStudents: boolean;
  courses: CourseSummary[];
};

/**
 * 교과목 목록입니다. 예전에는 여기서 학교 전체 학생 500명과 소유 퀴즈·패드 전부를 함께
 * 내려보냈는데, 400명 규모에서 매 요청마다 400명분 복호화가 돌고 교과목 10개면 체크박스
 * 4,000개가 DOM에 올라갔습니다. 이제 **개수만** 셉니다 — 실제 목록은 교과목을 열었을 때
 * `/api/subjects/[subjectId]/roster` 등이 페이지 단위로 가져옵니다.
 *
 * 학생 수는 개별 배정과 연결 학급의 합집합이라 `students.length`로 셀 수 없고,
 * `rosterMemberWhere`로 실제 사용자를 셉니다(lib/subjects/roster.ts).
 */
/**
 * 여러 교과목의 학생 수를 **한 번의 쿼리로** 셉니다.
 *
 * 교과목마다 `user.count()`를 돌리면 사이드바가 있는 모든 워크스페이스 화면에서 교과목 수만큼
 * 쿼리가 나갑니다(레이아웃은 페이지를 옮길 때마다 도는 게 아니라도 첫 진입마다 돕니다).
 * 명단이 "개별 배정 ∪ 학급 소속"이라 Prisma의 count 하나로는 표현할 수 없어서 UNION을 직접
 * 씁니다 — UNION이 중복을 지워 주므로 양쪽에 걸친 학생이 두 번 세지지 않습니다.
 */
async function countCourseStudents(subjectIds: string[]): Promise<Map<string, number>> {
  if (!subjectIds.length) return new Map();
  const rows = await getPrisma().$queryRaw<Array<{ subjectId: string; count: bigint }>>`
    SELECT "subjectId", COUNT(*)::bigint AS count FROM (
      SELECT ss."subjectId", u.id
        FROM "SubjectStudent" ss
        JOIN "User" u ON u.id = ss."studentId"
       WHERE ss."subjectId" = ANY(${subjectIds}) AND u.role = 'STUDENT' AND u.status = 'ACTIVE'
      UNION
      SELECT sg."subjectId", u.id
        FROM "SubjectSchoolGroup" sg
        JOIN "User" u ON u."schoolGroupId" = sg."schoolGroupId"
       WHERE sg."subjectId" = ANY(${subjectIds}) AND u.role = 'STUDENT' AND u.status = 'ACTIVE'
    ) AS roster
    GROUP BY "subjectId"
  `;
  return new Map(rows.map((row) => [row.subjectId, Number(row.count)]));
}

export const getCourseDashboardData = cache(async function getCourseDashboardData(user: CurrentUser): Promise<CourseDashboardData> {
  const prisma = getPrisma();
  const canAssign = canAssignStudentsToCourses(user);

  const [owned, memberships] = await Promise.all([
    prisma.subject.findMany({
      where: { ownerId: user.id },
      orderBy: { name: "asc" },
      select: {
        id: true,
        name: true,
        _count: {
          select: {
            quizzes: { where: { deletedAt: null } },
            boards: { where: { deletedAt: null } },
            forms: { where: { deletedAt: null } },
            schoolGroups: true,
          },
        },
      },
    }),
    // 학생은 자기가 배정받은(타인 소유) 교과목도 읽기 전용으로 봅니다. 학급 연결로 들어온
    // 교과목도 포함해야 하므로 SubjectStudent만 보지 않고 명단 조건으로 찾습니다.
    prisma.subject.findMany({
      where: {
        ownerId: { not: user.id },
        OR: [
          { students: { some: { studentId: user.id } } },
          { schoolGroups: { some: { schoolGroup: { users: { some: { id: user.id } } } } } },
        ],
      },
      orderBy: { name: "asc" },
      select: {
        id: true,
        name: true,
        owner: { select: { id: true, nameEncrypted: true, imageEncrypted: true } },
        _count: {
          select: {
            quizzes: { where: { deletedAt: null } },
            boards: { where: { deletedAt: null } },
            forms: { where: { deletedAt: null } },
            schoolGroups: true,
          },
        },
      },
    }),
  ]);

  const allIds = [...owned.map(({ id }) => id), ...memberships.map(({ id }) => id)];
  const studentCounts = await countCourseStudents(allIds);

  const courses: CourseSummary[] = [
    ...owned.map((subject) => ({
      id: subject.id,
      href: `${COURSE_LIST_PATH}/${subject.id}`,
      name: subject.name,
      quizCount: subject._count.quizzes,
      boardCount: subject._count.boards,
      formCount: subject._count.forms,
      studentCount: studentCounts.get(subject.id) ?? 0,
      groupCount: subject._count.schoolGroups,
      editable: true,
    })),
    ...memberships.map((subject) => ({
      id: subject.id,
      href: `${COURSE_LIST_PATH}/${subject.id}`,
      name: subject.name,
      quizCount: subject._count.quizzes,
      boardCount: subject._count.boards,
      formCount: subject._count.forms,
      studentCount: studentCounts.get(subject.id) ?? 0,
      groupCount: subject._count.schoolGroups,
      ownerName: toPublicAuthorDTO(subject.owner).name,
      editable: false,
    })),
  ];

  return {
    canManage: true,
    canAssignStudents: canAssign,
    courses: courses.sort((left, right) => left.name.localeCompare(right.name, "ko")),
  };
});

/** 교과목 하나의 요약. 상세 화면이 첫 렌더에 씁니다. */
export async function getCourseSummary(subjectId: string, viewerId: string): Promise<CourseSummary | null> {
  const prisma = getPrisma();
  const subject = await prisma.subject.findUnique({
    where: { id: subjectId },
    select: {
      id: true,
      name: true,
      ownerId: true,
      owner: { select: { id: true, nameEncrypted: true, imageEncrypted: true } },
      _count: {
        select: {
          quizzes: { where: { deletedAt: null } },
          boards: { where: { deletedAt: null } },
          forms: { where: { deletedAt: null } },
          schoolGroups: true,
        },
      },
    },
  });
  if (!subject) return null;
  return {
    id: subject.id,
    href: `${COURSE_LIST_PATH}/${subject.id}`,
    name: subject.name,
    quizCount: subject._count.quizzes,
    boardCount: subject._count.boards,
    formCount: subject._count.forms,
    studentCount: await prisma.user.count({ where: rosterMemberWhere(subjectId) }),
    groupCount: subject._count.schoolGroups,
    ownerName: toPublicAuthorDTO(subject.owner).name,
    editable: subject.ownerId === viewerId,
  };
}
