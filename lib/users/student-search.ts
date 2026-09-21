import "server-only";

import type { Prisma } from "@/generated/prisma/client";
import { getPrisma } from "@/lib/prisma";
import { decryptUserLoginIdentifier, toPublicAuthorDTO } from "@/lib/users/repository";

/**
 * 이름·로그인 아이디는 암호화 필드라 DB가 `LIKE` 검색을 못 합니다. 그래서 학생을 이름으로
 * 찾아야 하는 화면들 — 교과목 학생 후보(`lib/subjects/roster.ts`)와 퀴즈 할당 학생 후보
 * (`lib/quiz/assign-candidates.ts`) — 이 똑같은 방식을 씁니다.
 *
 *   ① 학급·학교 범위처럼 DB가 걸러 줄 수 있는 조건은 호출자가 만든 `where`로 먼저 좁히고
 *   ② 남은 후보를 최대 `STUDENT_SEARCH_SCAN_LIMIT`명까지 복호화해 이름·아이디·출석번호로
 *      메모리에서 거릅니다.
 *
 * 원래 `lib/subjects/roster.ts`의 `getCourseStudentCandidates` 안에만 있던 로직인데, 퀴즈
 * 할당 화면도 같은 스캔 검색이 필요해져서 도메인 중립으로 이 파일로 옮겼습니다. 호출자는
 * role·status·학교/학급 범위가 이미 완성된 `where`만 넘기면 됩니다 — "이 학생이 대상인가"는
 * 호출자 도메인의 책임이고, "이름으로 어떻게 찾는가"만 여기가 책임집니다.
 */
export const STUDENT_SEARCH_SCAN_LIMIT = 600;

export type StudentSearchHit = {
  id: string;
  name: string | null;
  loginId: string | null;
  studentNumber: number | null;
  className: string | null;
  gradeName: string | null;
};

export type StudentSearchPage = {
  students: StudentSearchHit[];
  totalCount: number;
  page: number;
  pageSize: number;
  truncated: boolean;
};

// 이름은 암호화 필드라 DB에서 정렬할 수 없습니다. 학급 → 출석번호 순은 교사가 실제로 명단을
// 읽는 순서이기도 합니다(lib/subjects/roster.ts의 옛 ROSTER_ORDER와 동일한 기준).
const SEARCH_ORDER: Prisma.UserOrderByWithRelationInput[] = [
  { schoolGroupId: "asc" },
  { studentNumber: "asc" },
  { createdAt: "asc" },
];

const SEARCH_SELECT = {
  id: true,
  loginIdentifierEncrypted: true,
  nameEncrypted: true,
  imageEncrypted: true,
  studentNumber: true,
  schoolGroup: { select: { name: true, grade: { select: { grade: true } } } },
} as const;

type SearchRow = Prisma.UserGetPayload<{ select: typeof SEARCH_SELECT }>;

function toStudentSearchHit(row: SearchRow): StudentSearchHit {
  return {
    id: row.id,
    name: toPublicAuthorDTO(row).name,
    loginId: decryptUserLoginIdentifier(row),
    studentNumber: row.studentNumber,
    className: row.schoolGroup?.name ?? null,
    gradeName: row.schoolGroup?.grade ? `${row.schoolGroup.grade.grade}학년` : null,
  };
}

type SearchActiveStudentsOptions = {
  /** role/status와 호출자 도메인의 범위 조건까지 완성해서 넘깁니다(학교/학급 범위, 이미 명단에
   *  든 학생 제외 등). 이 함수는 여기에 조건을 더 얹지 않고 그대로 씁니다. */
  where: Prisma.UserWhereInput;
  search?: string;
  page?: number;
  pageSize?: number;
};

/**
 * `where`를 만족하는 활성 학생을 검색어·페이지 단위로 읽습니다.
 *
 * 검색어가 없으면 DB가 직접 `count`/`skip`/`take`로 페이지네이션합니다. 검색어가 있으면
 * `STUDENT_SEARCH_SCAN_LIMIT + 1`명까지 읽어 복호화한 뒤 메모리에서 이름·아이디를 소문자
 * 비교로 거르고, 숫자 1~2자리는 출석번호로도 매칭합니다(교사가 "3반 12번"을 그렇게 부릅니다).
 * 스캔 상한을 넘기면 `truncated: true`를 돌려줍니다 — 검색어가 너무 넓으면 "더 좁혀 달라"고
 * 안내하는 편이, 수천 명을 복호화하고 타임아웃 나는 것보다 낫습니다.
 */
export async function searchActiveStudents(options: SearchActiveStudentsOptions): Promise<StudentSearchPage> {
  const { where, search = "", page = 1, pageSize = 50 } = options;
  const prisma = getPrisma();
  const requestedPage = Math.max(1, Math.floor(page));
  const term = search.trim();

  if (!term) {
    const totalCount = await prisma.user.count({ where });
    const safePage = Math.min(requestedPage, Math.max(1, Math.ceil(totalCount / pageSize)));
    const rows = await prisma.user.findMany({
      where,
      orderBy: SEARCH_ORDER,
      skip: (safePage - 1) * pageSize,
      take: pageSize,
      select: SEARCH_SELECT,
    });
    return { students: rows.map(toStudentSearchHit), totalCount, page: safePage, pageSize, truncated: false };
  }

  // 숫자만 입력하면 출석번호로도 찾습니다(교사가 "3반 12번"을 그렇게 부릅니다).
  const asNumber = /^\d{1,2}$/.test(term) ? Number(term) : null;
  const scanned = await prisma.user.findMany({
    where: asNumber === null ? where : { OR: [where, { ...where, studentNumber: asNumber }] },
    orderBy: SEARCH_ORDER,
    take: STUDENT_SEARCH_SCAN_LIMIT + 1,
    select: SEARCH_SELECT,
  });
  const truncated = scanned.length > STUDENT_SEARCH_SCAN_LIMIT;
  const needle = term.toLowerCase();
  const matched = scanned.slice(0, STUDENT_SEARCH_SCAN_LIMIT)
    .map(toStudentSearchHit)
    .filter((student) =>
      (student.name?.toLowerCase().includes(needle) ?? false)
      || (student.loginId?.toLowerCase().includes(needle) ?? false)
      || (asNumber !== null && student.studentNumber === asNumber));

  const safePage = Math.min(requestedPage, Math.max(1, Math.ceil(matched.length / pageSize)));
  return {
    students: matched.slice((safePage - 1) * pageSize, safePage * pageSize),
    totalCount: matched.length,
    page: safePage,
    pageSize,
    truncated,
  };
}
