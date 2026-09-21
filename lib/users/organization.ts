import "server-only";

import { getPrisma } from "@/lib/prisma";
import { decryptOptionalUserPii } from "@/lib/security/pii-crypto";

export const DEFAULT_SCHOOL_ID = "school_cheonghak_high";
export const DEFAULT_STUDENT_GROUP_ID = "group_cheonghak_grade3_class5";
export const DEFAULT_TEACHER_GROUP_ID = "group_cheonghak_grade3_department";

// Prisma의 orderBy 배열은 mutable이어야 해서, 이 함수 전체를 as const로 얼리면 안 되고
// "asc" 리터럴만 각각 얼립니다. 학교 목록 조회 두 곳(getSchoolDirectory/getAdminSchoolPage)에서
// 매번 새로 호출해 공유합니다.
function schoolGroupsArgs() {
  return {
    orderBy: [
      { type: "asc" as const },
      { grade: { grade: "asc" as const } },
      { classNumber: "asc" as const },
      { name: "asc" as const },
    ],
    select: {
      id: true,
      name: true,
      type: true,
      classNumber: true,
      grade: { select: { grade: true } },
      _count: { select: { users: true } },
    },
  };
}

function serializeGroup(group: { id: string; name: string; type: "CLASS" | "DEPARTMENT"; classNumber: number | null; grade: { grade: number } | null; _count: { users: number } }) {
  return {
    id: group.id,
    name: group.name,
    type: group.type,
    grade: group.grade?.grade ?? null,
    classNumber: group.classNumber,
    userCount: group._count.users,
    isDefault: group.id === DEFAULT_STUDENT_GROUP_ID || group.id === DEFAULT_TEACHER_GROUP_ID,
  };
}

// 소속 삭제 전에 몇 명이 영향을 받는지 보여주려고(School.groups는 onDelete: Cascade,
// User.schoolId/schoolGroupId는 onDelete: SetNull) 학교·반/부서 각각의 소속 인원수를 함께 조회합니다.
//
// 이 함수는 학교 목록 전체가 필요한 화면(사용자 필터 드롭다운, 명단 발급 대상 선택, 학교
// 대시보드의 전체 학교 합계)에서 공통으로 씁니다. 그래서 학교 수가 늘어도 안전하도록 학교당
// 무거운 데이터(교사 명단 PII 복호화)는 빼고, 반/부서·인원수 같은 가벼운 집계만 담습니다.
// 학교별 교사 명단이 필요한 "소속 관리" 탭은 getAdminSchoolPage()의 페이지네이션된 결과를 씁니다.
export async function getSchoolDirectory() {
  const prisma = getPrisma();
  const [schools, roleCounts, unnumberedCounts, unassignedCounts] = await Promise.all([
    prisma.school.findMany({
      orderBy: { name: "asc" },
      select: {
        id: true,
        name: true,
        code: true,
        level: true,
        district: true,
        operatingStatus: true,
        _count: { select: { users: true } },
        groups: schoolGroupsArgs(),
      },
    }),
    prisma.user.groupBy({
      by: ["schoolId", "role"],
      where: { schoolId: { not: null }, status: { not: "DELETED" } },
      _count: { _all: true },
    }),
    prisma.user.groupBy({
      by: ["schoolId"],
      where: { schoolId: { not: null }, role: "STUDENT", status: { not: "DELETED" }, studentNumber: null },
      _count: { _all: true },
    }),
    prisma.user.groupBy({
      by: ["schoolId"],
      where: { schoolId: { not: null }, role: "STUDENT", status: { not: "DELETED" }, schoolGroupId: null },
      _count: { _all: true },
    }),
  ]);
  const countFor = (schoolId: string, role: "STUDENT" | "TEACHER") => roleCounts.find((item) => item.schoolId === schoolId && item.role === role)?._count._all ?? 0;
  const groupedCountFor = (rows: typeof unnumberedCounts, schoolId: string) => rows.find((item) => item.schoolId === schoolId)?._count._all ?? 0;
  return schools.map((school) => ({
    id: school.id,
    name: school.name,
    code: school.code,
    level: school.level,
    district: school.district,
    operatingStatus: school.operatingStatus,
    userCount: school._count.users,
    studentCount: countFor(school.id, "STUDENT"),
    teacherCount: countFor(school.id, "TEACHER"),
    unnumberedStudentCount: groupedCountFor(unnumberedCounts, school.id),
    unassignedStudentCount: groupedCountFor(unassignedCounts, school.id),
    isDefault: school.id === DEFAULT_SCHOOL_ID,
    groups: school.groups.map(serializeGroup),
  }));
}

// "소속 관리" 탭 전용입니다. 학교당 활성 교사 명단(PII 복호화 포함)을 담는 무거운 조회라서
// 학교가 많아도 화면에 보이는 페이지 분량만큼만 가져오도록 스킵/테이크로 나눕니다. 역할별
// 인원 집계도 이번 페이지에 뽑힌 학교로만 좁혀서, 페이지 크기와 무관하게 전체 사용자 테이블을
// 스캔하지 않게 합니다.
export async function getAdminSchoolPage({ page, pageSize, search, schoolId }: { page: number; pageSize: number; search?: string; schoolId?: string }) {
  const prisma = getPrisma();
  const searchFilter = search
    ? { OR: [{ name: { contains: search, mode: "insensitive" as const } }, { code: { contains: search, mode: "insensitive" as const } }] }
    : {};
  const where = schoolId ? { id: schoolId, ...searchFilter } : searchFilter;
  const [totalCount, schools] = await Promise.all([
    prisma.school.count({ where }),
    prisma.school.findMany({
      where,
      orderBy: { name: "asc" },
      skip: (page - 1) * pageSize,
      take: pageSize,
      select: {
        id: true,
        name: true,
        code: true,
        level: true,
        district: true,
        operatingStatus: true,
        _count: { select: { users: true } },
        users: {
          where: { role: "TEACHER", status: "ACTIVE" },
          orderBy: [{ createdAt: "asc" }, { id: "asc" }],
          select: { id: true, nameEncrypted: true, isSchoolRepresentative: true, schoolGroup: { select: { name: true } } },
        },
        groups: schoolGroupsArgs(),
      },
    }),
  ]);
  const schoolIds = schools.map((school) => school.id);
  const [roleCounts, unnumberedCounts, unassignedCounts] = schoolIds.length
    ? await Promise.all([
        prisma.user.groupBy({
          by: ["schoolId", "role"],
          where: { schoolId: { in: schoolIds }, status: { not: "DELETED" } },
          _count: { _all: true },
        }),
        prisma.user.groupBy({
          by: ["schoolId"],
          where: { schoolId: { in: schoolIds }, role: "STUDENT", status: { not: "DELETED" }, studentNumber: null },
          _count: { _all: true },
        }),
        prisma.user.groupBy({
          by: ["schoolId"],
          where: { schoolId: { in: schoolIds }, role: "STUDENT", status: { not: "DELETED" }, schoolGroupId: null },
          _count: { _all: true },
        }),
      ])
    : [[], [], []];
  const countFor = (schoolId: string, role: "STUDENT" | "TEACHER") => roleCounts.find((item) => item.schoolId === schoolId && item.role === role)?._count._all ?? 0;
  const groupedCountFor = (rows: typeof unnumberedCounts, schoolId: string) => rows.find((item) => item.schoolId === schoolId)?._count._all ?? 0;
  return {
    schools: schools.map((school) => ({
      id: school.id,
      name: school.name,
      code: school.code,
      level: school.level,
      district: school.district,
      operatingStatus: school.operatingStatus,
      userCount: school._count.users,
      studentCount: countFor(school.id, "STUDENT"),
      teacherCount: countFor(school.id, "TEACHER"),
      unnumberedStudentCount: groupedCountFor(unnumberedCounts, school.id),
      unassignedStudentCount: groupedCountFor(unassignedCounts, school.id),
      isDefault: school.id === DEFAULT_SCHOOL_ID,
      teachers: school.users.map((teacher) => ({
        id: teacher.id,
        name: decryptOptionalUserPii(teacher.id, "name", teacher.nameEncrypted),
        departmentName: teacher.schoolGroup?.name ?? null,
        isSchoolRepresentative: teacher.isSchoolRepresentative,
      })),
      groups: school.groups.map(serializeGroup),
    })),
    totalCount,
    page,
    pageSize,
  };
}

// 가입 화면은 관리자용 인원수·기본 소속 플래그가 필요 없으므로 선택에 필요한 최소 필드만
// 내려줍니다. 가입자는 이 디렉터리에 등록된 학교와 반/부서만 선택할 수 있습니다.
export async function getOnboardingOrganizationOptions() {
  return getPrisma().school.findMany({
    orderBy: { name: "asc" },
    select: {
      id: true,
      name: true,
      groups: {
        orderBy: [{ type: "asc" }, { grade: { grade: "asc" } }, { classNumber: "asc" }, { name: "asc" }],
        select: {
          id: true,
          name: true,
          type: true,
          classNumber: true,
          grade: { select: { grade: true } },
        },
      },
    },
  }).then((schools) => schools.map((school) => ({
    ...school,
    groups: school.groups.map((group) => ({
      id: group.id,
      name: group.name,
      type: group.type,
      grade: group.grade?.grade ?? null,
      classNumber: group.classNumber,
    })),
  })));
}
