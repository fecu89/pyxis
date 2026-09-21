import "../lib/load-env";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { encode } from "next-auth/jwt";
import { getPrisma } from "../lib/prisma";
import { createLoginIdentifierLookup, createNicknameLookup, decryptUserPii, encryptOptionalUserPii, encryptUserPii, maskLoginIdentifier } from "../lib/security/pii-crypto-core";
import { createPadActivity } from "./fixtures";

const baseUrl = process.env.VERIFY_BASE_URL || "http://localhost:3001";
function requireAuthSecret() {
  const value = process.env.AUTH_SECRET;
  if (!value) throw new Error("AUTH_SECRET 환경 변수가 필요합니다.");
  return value;
}

const secret = requireAuthSecret();
// APP_ORIGINS가 있는 로컬 서버는 요청 URL(localhost)과 허용 Origin(배포 주소)이 다를 수
// 있습니다. 검증 트래픽은 실제 브라우저와 같은 허용 Origin을 쓰되, 목적지는 로컬 서버로 둡니다.
const requestOrigin = process.env.VERIFY_ORIGIN || process.env.APP_ORIGINS?.split(",")[0]?.trim() || baseUrl;
const cleanupUserIds = new Set<string>();
const cleanupBoardIds = new Set<string>();
let cleanupSchoolId: string | null = null;

async function sessionCookie(user: { id: string; authVersion: number }, onboardingState: "PROFILE" | "COMPLETE" = "COMPLETE") {
  const token = await encode({
    secret,
    maxAge: 300,
    token: {
      userId: user.id,
      authVersion: user.authVersion,
      sessionInvalid: false,
      onboardingState,
      onboardingCompleted: onboardingState === "COMPLETE",
    },
  });
  return `next-auth.session-token=${token}; __Secure-next-auth.session-token=${token}`;
}

async function main() {
  const prisma = getPrisma();
  const verificationAdminId = randomUUID();
  const verificationAdminEmail = `verify-admin-${verificationAdminId}@invalid.local`;
  cleanupUserIds.add(verificationAdminId);
  const superAdmin = await prisma.user.create({
    data: {
      id: verificationAdminId,
      loginIdentifierLookup: createLoginIdentifierLookup(verificationAdminEmail),
      loginIdentifierEncrypted: encryptUserPii(verificationAdminId, "email", verificationAdminEmail),
      nameEncrypted: encryptOptionalUserPii(verificationAdminId, "name", "검증용 전체관리자"),
      role: "SUPER_ADMIN",
      lastLoginAt: new Date(),
    },
    select: { id: true, authVersion: true },
  });
  const verificationStudentId = randomUUID();
  const verificationStudentEmail = `verify-student-${verificationStudentId}@invalid.local`;
  cleanupUserIds.add(verificationStudentId);
  await prisma.user.create({
    data: {
      id: verificationStudentId,
      loginIdentifierLookup: createLoginIdentifierLookup(verificationStudentEmail),
      loginIdentifierEncrypted: encryptUserPii(verificationStudentId, "email", verificationStudentEmail),
      nameEncrypted: encryptOptionalUserPii(verificationStudentId, "name", "검증용 학생"),
      nameLookup: createNicknameLookup("검증용 학생"),
      role: "STUDENT",
    },
  });
  const verificationBoard = await prisma.board.create({
    data: {
      slug: `verify-admin-http-${randomUUID()}`,
      title: "[검증용] 공개 패드",
      ownerId: verificationAdminId,
      activityId: await createPadActivity(prisma, verificationAdminId, "[검증용] 공개 패드"),
      discoveryScope: "PUBLIC",
      visitorPermission: "READER",
      loginRequired: false,
      members: {
        create: [
          { userId: verificationAdminId, role: "OWNER" },
          { userId: verificationStudentId, role: "MEMBER" },
        ],
      },
    },
    select: { id: true },
  });
  cleanupBoardIds.add(verificationBoard.id);
  const student = await prisma.user.findUnique({
    where: { id: verificationStudentId },
    select: { id: true, authVersion: true, loginIdentifierEncrypted: true, memberships: { where: { board: { deletedAt: null, discoveryScope: "PUBLIC" }, role: "MEMBER" }, take: 1, select: { boardId: true, board: { select: { slug: true } } } } },
  });
  assert.ok(student, "권한 차단 검증용 활성 학생이 필요합니다.");
  const [superCookie, studentCookie] = await Promise.all([sessionCookie(superAdmin), sessionCookie(student)]);

  const anonymousUsers = await fetch(`${baseUrl}/api/admin/users`);
  assert.equal(anonymousUsers.status, 401, "비로그인 관리자 API는 401이어야 합니다.");

  const superUsers = await fetch(`${baseUrl}/api/admin/users?page=1&pageSize=10`, { headers: { Cookie: superCookie } });
  assert.equal(superUsers.status, 200, `전체관리자는 사용자 목록을 조회할 수 있어야 합니다: ${await superUsers.clone().text()}`);
  const userPage = await superUsers.json() as { users?: unknown[]; totalCount?: number; page?: number; pageSize?: number };
  assert.ok(Array.isArray(userPage.users), "사용자 목록 응답 형식이 올바르지 않습니다.");
  assert.equal(userPage.page, 1);
  assert.equal(userPage.pageSize, 10);
  assert.equal(typeof userPage.totalCount, "number");
  assert.doesNotMatch(JSON.stringify(userPage), /loginIdentifierEncrypted|nameEncrypted|imageEncrypted|v1:/, "관리자 목록에 암호문이 노출되면 안 됩니다.");

  const nameSearchResponse = await fetch(`${baseUrl}/api/admin/users?page=1&pageSize=10&q=${encodeURIComponent("검증용 학")}`, {
    headers: { Cookie: superCookie },
  });
  assert.equal(nameSearchResponse.status, 200, "관리자 사용자 목록에서 이름 부분 검색을 할 수 있어야 합니다.");
  const nameSearch = await nameSearchResponse.json() as {
    users: Array<{ id: string; loginIdentifier: string; maskedLoginIdentifier?: string }>;
  };
  const searchedStudent = nameSearch.users.find((user) => user.id === verificationStudentId);
  assert.ok(searchedStudent, "학생 이름·닉네임 부분 검색 결과에 대상 학생이 없습니다.");
  assert.equal(searchedStudent.loginIdentifier, verificationStudentEmail, "관리자 사용자 목록은 로그인 식별자 전체를 반환해야 합니다.");
  assert.equal(searchedStudent.maskedLoginIdentifier, undefined, "관리자 사용자 목록에 예전 마스킹 필드가 남아 있습니다.");

  const auditLogs = await fetch(`${baseUrl}/api/admin/audit-logs?limit=5`, { headers: { Cookie: superCookie } });
  assert.equal(auditLogs.status, 200, "전체관리자는 감사 로그를 조회할 수 있어야 합니다.");

  const adminPage = await fetch(`${baseUrl}/admin`, { headers: { Cookie: superCookie } });
  assert.equal(adminPage.status, 200, "전체관리자 관리자 페이지가 열려야 합니다.");
  assert.match(adminPage.url, /\/admin\/dashboard$/u, "관리자 루트는 권한에 맞는 정식 하위 라우트로 이동해야 합니다.");
  const adminHtml = await adminPage.text();
  assert.match(adminHtml, /관리자 센터|사용자와 권한/);
  assert.match(adminHtml, /학교 대시보드/u, "관리자 첫 화면에 학교 대시보드 메뉴가 있어야 합니다.");
  assert.doesNotMatch(adminHtml, /학급·담임|전출 예정|재적 상태/u, "제거한 학사 관리 기능이 관리자 화면에 남으면 안 됩니다.");
  assert.doesNotMatch(adminHtml, /loginIdentifierEncrypted|nameEncrypted|imageEncrypted|v1:/, "관리자 HTML에 암호문이 노출되면 안 됩니다.");

  const adminRoutePages = await Promise.all(["settings", "audio", "audit", "users", "boards", "quizzes", "forms"].map(async (route) => {
    const response = await fetch(`${baseUrl}/admin/${route}`, { headers: { Cookie: superCookie } });
    return { route, response };
  }));
  for (const { route, response } of adminRoutePages) {
    assert.equal(response.status, 200, `관리자 ${route} 라우트가 열려야 합니다: ${await response.clone().text()}`);
  }
  const legacyAdminTab = await fetch(`${baseUrl}/admin?tab=audio`, { headers: { Cookie: superCookie }, redirect: "manual" });
  assert.ok([307, 308].includes(legacyAdminTab.status), "예전 관리자 tab 주소는 새 라우트로 리다이렉트해야 합니다.");
  assert.equal(new URL(legacyAdminTab.headers.get("location") ?? "", baseUrl).pathname, "/admin/audio");

  const quizDiscover = await fetch(`${baseUrl}/quiz/discover`, { headers: { Cookie: superCookie } });
  assert.equal(quizDiscover.status, 200, "퀴즈 탐색 정식 라우트가 열려야 합니다.");
  assert.match(await quizDiscover.text(), /퀴즈 탐색/u);
  const legacyQuizDiscover = await fetch(`${baseUrl}/quiz?tab=discover&q=검증`, { headers: { Cookie: superCookie }, redirect: "manual" });
  assert.ok([307, 308].includes(legacyQuizDiscover.status), "예전 퀴즈 탐색 tab 주소는 새 라우트로 리다이렉트해야 합니다.");
  const legacyQuizLocation = new URL(legacyQuizDiscover.headers.get("location") ?? "", baseUrl);
  assert.equal(legacyQuizLocation.pathname, "/quiz/discover");
  assert.equal(legacyQuizLocation.searchParams.get("q"), "검증");

  const routedLibraryPages = await Promise.all([
    "/quiz/favorites", "/quiz/assigned", "/quiz/unassigned", "/quiz/drafts",
    "/forms/open", "/forms/drafts", "/forms/closed",
    "/report/quizzes", "/report/pads", "/report/forms",
  ].map(async (pathname) => ({ pathname, response: await fetch(`${baseUrl}${pathname}`, { headers: { Cookie: superCookie } }) })));
  for (const { pathname, response } of routedLibraryPages) {
    assert.equal(response.status, 200, `${pathname} 정식 하위 라우트가 열려야 합니다: ${await response.clone().text()}`);
  }

  const legacyRouteCases = [
    { source: "/quiz?view=FAVORITES&q=검증", pathname: "/quiz/favorites", key: "q", value: "검증" },
    { source: "/forms?view=OPEN&page=2", pathname: "/forms/open", key: "page", value: "2" },
    { source: "/report?type=PAD_BOARD&page=2", pathname: "/report/pads", key: "page", value: "2" },
  ] as const;
  for (const testCase of legacyRouteCases) {
    const response = await fetch(`${baseUrl}${testCase.source}`, { headers: { Cookie: superCookie }, redirect: "manual" });
    assert.ok([307, 308].includes(response.status), `예전 ${testCase.source} 주소는 정식 하위 라우트로 리다이렉트해야 합니다.`);
    const location = new URL(response.headers.get("location") ?? "", baseUrl);
    assert.equal(location.pathname, testCase.pathname);
    assert.equal(location.searchParams.get(testCase.key), testCase.value);
  }

  const studentUsers = await fetch(`${baseUrl}/api/admin/users`, { headers: { Cookie: studentCookie } });
  assert.equal(studentUsers.status, 403, "학생의 관리자 API 접근은 403이어야 합니다.");

  // 로그인 사용자가 보는 "내 패드"는 `/pad`입니다. `/`는 비로그인 마케팅 화면이고, 로그인
  // 상태로 열면 대시보드로 넘어갑니다(병합에서 `/dashboard`가 통합 홈으로 의미가 바뀌면서
  // 패드 목록이 `/pad`로 빠졌습니다).
  const [anonymousHome, superHome, studentHome] = await Promise.all([
    fetch(`${baseUrl}/`),
    fetch(`${baseUrl}/pad`, { headers: { Cookie: superCookie } }),
    fetch(`${baseUrl}/pad`, { headers: { Cookie: studentCookie } }),
  ]);
  assert.equal(anonymousHome.status, 200, "비로그인 홈이 열려야 합니다.");
  assert.equal(superHome.status, 200, "전체관리자 내 패드가 열려야 합니다.");
  assert.equal(studentHome.status, 200, "학생 내 패드가 열려야 합니다.");
  const [anonymousHomeHtml, superHomeHtml, studentHomeHtml] = await Promise.all([
    anonymousHome.text(),
    superHome.text(),
    studentHome.text(),
  ]);
  assert.doesNotMatch(anonymousHomeHtml, /data-home-action="create-board"/, "비로그인 SSR에 보드 생성 UI가 포함되면 안 됩니다.");
  assert.doesNotMatch(anonymousHomeHtml, /data-home-dashboard/, "비로그인 SSR에 개인 대시보드가 포함되면 안 됩니다.");
  assert.match(superHomeHtml, /data-home-action="create-board"/, "전체관리자 /pad SSR에는 보드 생성 UI가 있어야 합니다.");
  assert.match(superHomeHtml, /data-home-dashboard/, "전체관리자 /pad SSR에는 내 패드 목록이 있어야 합니다.");
  assert.match(studentHomeHtml, /data-home-action="create-board"/, "학생 /pad SSR에도 보드 생성 UI가 있어야 합니다.");
  assert.match(studentHomeHtml, /data-home-dashboard/, "학생 /pad SSR에는 참여 보드 목록이 있어야 합니다.");

  const studentCreateBoard = await fetch(`${baseUrl}/api/boards`, {
    method: "POST",
    headers: { Cookie: studentCookie, Origin: requestOrigin, "Content-Type": "application/json" },
    body: JSON.stringify({ title: "학생 패드 생성 검증", discoveryScope: "PRIVATE" }),
  });
  assert.equal(studentCreateBoard.status, 201, `학생도 패드를 만들 수 있어야 합니다: ${await studentCreateBoard.clone().text()}`);
  const firstStudentBoard = (await studentCreateBoard.json() as { board: { id: string } }).board;
  cleanupBoardIds.add(firstStudentBoard.id);

  const quotaBoardIds = Array.from({ length: 8 }, () => randomUUID());
  quotaBoardIds.forEach((id) => cleanupBoardIds.add(id));
  const quotaActivityIds = await Promise.all(
    quotaBoardIds.map((_, index) => createPadActivity(prisma, student.id, `[검증용] 학생 한도 ${index + 2}`)),
  );
  await prisma.board.createMany({
    data: quotaBoardIds.map((id, index) => ({
      id,
      slug: `verify-student-quota-${index}-${randomUUID()}`,
      title: `[검증용] 학생 한도 ${index + 2}`,
      ownerId: student.id,
      activityId: quotaActivityIds[index],
    })),
  });
  assert.equal(await prisma.board.count({ where: { ownerId: student.id } }), 9);

  const concurrentCreates = await Promise.all(["A", "B"].map((suffix) => fetch(`${baseUrl}/api/boards`, {
    method: "POST",
    headers: { Cookie: studentCookie, Origin: requestOrigin, "Content-Type": "application/json" },
    body: JSON.stringify({ title: `학생 동시 생성 ${suffix}`, discoveryScope: "PRIVATE" }),
  })));
  assert.deepEqual(concurrentCreates.map(({ status }) => status).sort(), [201, 409], "9개에서 동시에 두 번 생성해도 하나만 성공해야 합니다.");
  for (const response of concurrentCreates) {
    if (response.status === 201) cleanupBoardIds.add((await response.json() as { board: { id: string } }).board.id);
    else assert.match(await response.text(), /최대 10개/u);
  }
  assert.equal(await prisma.board.count({ where: { ownerId: student.id } }), 10, "학생 소유 패드는 동시에 요청해도 10개를 넘으면 안 됩니다.");

  const cloneAtLimit = await fetch(`${baseUrl}/api/boards/${verificationBoard.id}/clone`, {
    method: "POST",
    headers: { Cookie: studentCookie, Origin: requestOrigin, "Content-Type": "application/json" },
    body: JSON.stringify({ includeSections: false, includePosts: false, includeAttachments: false, includeSettings: false, includeMembers: false }),
  });
  assert.equal(cloneAtLimit.status, 409, "복제로도 학생 소유 패드 10개 제한을 넘을 수 없어야 합니다.");
  assert.match(await cloneAtLimit.text(), /최대 10개/u);

  const studentBoardId = student.memberships[0]?.boardId;
  assert.ok(studentBoardId, "학생 보관함 검증용 보드 멤버십이 필요합니다.");
  const studentTrash = await fetch(`${baseUrl}/api/boards/${studentBoardId}/trash`, { headers: { Cookie: studentCookie } });
  assert.equal(studentTrash.status, 200, "보드 멤버인 학생은 자신의 복구 가능 항목 보관함을 열 수 있어야 합니다.");
  assert.doesNotMatch(await studentTrash.text(), /loginIdentifierEncrypted|nameEncrypted|imageEncrypted|v1:/, "보관함에 암호문이 노출되면 안 됩니다.");

  const publicBoardSlug = student.memberships[0]?.board.slug;
  assert.ok(publicBoardSlug, "공개 보드 개인정보 노출 검증용 slug가 필요합니다.");
  const publicBoard = await fetch(`${baseUrl}/b/${publicBoardSlug}`);
  assert.equal(publicBoard.status, 200, "공개 보드는 비로그인 상태에서 열려야 합니다.");
  const publicBoardHtml = await publicBoard.text();
  const studentMaskedEmail = maskLoginIdentifier(decryptUserPii(student.id, "email", student.loginIdentifierEncrypted));
  assert.ok(!publicBoardHtml.includes(studentMaskedEmail), "공개 보드 HTML에 멤버의 마스킹 이메일도 노출되면 안 됩니다.");
  assert.doesNotMatch(publicBoardHtml, /loginIdentifierEncrypted|nameEncrypted|imageEncrypted|v1:/, "공개 보드 HTML에 암호문이 노출되면 안 됩니다.");

  const crossOriginAdminMutation = await fetch(`${baseUrl}/api/admin/users/${student.id}`, {
    method: "PATCH",
    headers: { Cookie: superCookie, Origin: "https://invalid.example", "Content-Type": "application/json" },
    body: JSON.stringify({ status: "SUSPENDED", reason: "교차 출처 차단 검증" }),
  });
  assert.equal(crossOriginAdminMutation.status, 403, "교차 출처 관리자 변경 요청은 403이어야 합니다.");

  const organizationKey = randomUUID().slice(0, 8);
  const schoolCreate = await fetch(`${baseUrl}/api/admin/schools`, {
    method: "POST",
    headers: { Cookie: superCookie, Origin: requestOrigin, "Content-Type": "application/json" },
    body: JSON.stringify({ name: `검증학교-${organizationKey}` }),
  });
  assert.equal(schoolCreate.status, 201, `전체관리자는 학교를 추가할 수 있어야 합니다: ${await schoolCreate.clone().text()}`);
  const schoolCreateResult = await schoolCreate.json() as { school: { id: string; name: string; userCount: number } };
  cleanupSchoolId = schoolCreateResult.school.id;
  assert.equal(schoolCreateResult.school.userCount, 0);

  const schoolRename = await fetch(`${baseUrl}/api/admin/schools/${cleanupSchoolId}`, {
    method: "PATCH",
    headers: { Cookie: superCookie, Origin: requestOrigin, "Content-Type": "application/json" },
    body: JSON.stringify({ name: `검증학교수정-${organizationKey}`, code: `V${organizationKey}`, level: "HIGH", district: "검증구", operatingStatus: "OPERATING" }),
  });
  assert.equal(schoolRename.status, 200, "전체관리자는 학교 이름을 변경할 수 있어야 합니다.");

  const classCreate = await fetch(`${baseUrl}/api/admin/schools/${cleanupSchoolId}/groups`, {
    method: "POST",
    headers: { Cookie: superCookie, Origin: requestOrigin, "Content-Type": "application/json" },
    body: JSON.stringify({ grade: 1, classNumber: 9, type: "CLASS" }),
  });
  assert.equal(classCreate.status, 201, `전체관리자는 반을 추가할 수 있어야 합니다: ${await classCreate.clone().text()}`);
  const classCreateResult = await classCreate.json() as { group?: { id: string } };
  assert.ok(classCreateResult.group?.id, `생성한 반 ID가 응답에 있어야 합니다: ${JSON.stringify(classCreateResult)}`);
  const classGroup = classCreateResult.group;

  const invalidHighSchoolClass = await fetch(`${baseUrl}/api/admin/schools/${cleanupSchoolId}/groups`, {
    method: "POST",
    headers: { Cookie: superCookie, Origin: requestOrigin, "Content-Type": "application/json" },
    body: JSON.stringify({ grade: 4, classNumber: 1, type: "CLASS" }),
  });
  assert.equal(invalidHighSchoolClass.status, 400, "고등학교에는 4학년 학급을 만들 수 없어야 합니다.");

  const departmentCreate = await fetch(`${baseUrl}/api/admin/schools/${cleanupSchoolId}/groups`, {
    method: "POST",
    headers: { Cookie: superCookie, Origin: requestOrigin, "Content-Type": "application/json" },
    body: JSON.stringify({ name: "검증부서", type: "DEPARTMENT" }),
  });
  assert.equal(departmentCreate.status, 201, "전체관리자는 부서를 추가할 수 있어야 합니다.");
  const departmentGroup = (await departmentCreate.json() as { group: { id: string } }).group;

  const schoolTeacherId = randomUUID();
  const schoolTeacherEmail = `verify-school-teacher-${schoolTeacherId}@invalid.local`;
  cleanupUserIds.add(schoolTeacherId);
  const schoolTeacher = await prisma.user.create({
    data: {
      id: schoolTeacherId,
      loginIdentifierLookup: createLoginIdentifierLookup(schoolTeacherEmail),
      loginIdentifierEncrypted: encryptUserPii(schoolTeacherId, "email", schoolTeacherEmail),
      nameEncrypted: encryptOptionalUserPii(schoolTeacherId, "name", "검증용 일반교사"),
      role: "TEACHER",
      schoolId: cleanupSchoolId,
      schoolGroupId: departmentGroup.id,
      onboardingCompletedAt: new Date(),
    },
    select: { id: true, authVersion: true },
  });
  let schoolTeacherCookie = await sessionCookie(schoolTeacher);
  const schoolTeacherAdminPage = await fetch(`${baseUrl}/admin/users`, { headers: { Cookie: schoolTeacherCookie } });
  assert.equal(schoolTeacherAdminPage.status, 200, "일반 교사도 자기 학교 학생 번호 관리 화면에 들어갈 수 있어야 합니다.");
  assert.match(await schoolTeacherAdminPage.text(), /학생 번호 관리|학급·부서·학생 번호/u);

  const outOfSchoolStudentId = randomUUID();
  const outOfSchoolStudentEmail = `verify-out-of-school-${outOfSchoolStudentId}@invalid.local`;
  cleanupUserIds.add(outOfSchoolStudentId);
  await prisma.user.create({
    data: {
      id: outOfSchoolStudentId,
      loginIdentifierLookup: createLoginIdentifierLookup(outOfSchoolStudentEmail),
      loginIdentifierEncrypted: encryptUserPii(outOfSchoolStudentId, "email", outOfSchoolStudentEmail),
      nameEncrypted: encryptOptionalUserPii(outOfSchoolStudentId, "name", "타교 학생 검증"),
      role: "STUDENT",
      schoolId: "school_cheonghak_high",
      schoolGroupId: "group_cheonghak_grade3_class5",
      onboardingCompletedAt: new Date(),
    },
  });

  const studentOnboardingCookie = await sessionCookie(student, "PROFILE");
  const studentOnboardingPage = await fetch(`${baseUrl}/onboarding`, { headers: { Cookie: studentOnboardingCookie } });
  assert.equal(studentOnboardingPage.status, 200);
  assert.match(await studentOnboardingPage.text(), /학년[\s\S]*반[\s\S]*번호/u, "학생 가입 화면에 학년·반·번호 입력 단계가 보여야 합니다.");

  const studentOnboarding = await fetch(`${baseUrl}/api/onboarding`, {
    method: "POST",
    headers: { Cookie: studentOnboardingCookie, Origin: requestOrigin, "Content-Type": "application/json" },
    body: JSON.stringify({
      name: "검증용 학생",
      accountType: "STUDENT",
      schoolId: cleanupSchoolId,
      schoolGroupId: classGroup.id,
      studentNumber: 6,
    }),
  });
  assert.equal(studentOnboarding.status, 200, `학생 온보딩에서 학년·반·번호를 저장할 수 있어야 합니다: ${await studentOnboarding.clone().text()}`);
  assert.deepEqual(
    await prisma.user.findUnique({ where: { id: student.id }, select: { schoolGroupId: true, studentNumber: true } }),
    { schoolGroupId: classGroup.id, studentNumber: 6 },
  );

  const duplicateNumberStudentId = randomUUID();
  const duplicateNumberEmail = `verify-duplicate-number-${duplicateNumberStudentId}@invalid.local`;
  cleanupUserIds.add(duplicateNumberStudentId);
  const duplicateNumberStudent = await prisma.user.create({
    data: {
      id: duplicateNumberStudentId,
      loginIdentifierLookup: createLoginIdentifierLookup(duplicateNumberEmail),
      loginIdentifierEncrypted: encryptUserPii(duplicateNumberStudentId, "email", duplicateNumberEmail),
      role: "STUDENT",
    },
    select: { id: true, authVersion: true },
  });
  const duplicateNumberCookie = await sessionCookie(duplicateNumberStudent, "PROFILE");
  const duplicateNumberOnboarding = await fetch(`${baseUrl}/api/onboarding`, {
    method: "POST",
    headers: { Cookie: duplicateNumberCookie, Origin: requestOrigin, "Content-Type": "application/json" },
    body: JSON.stringify({
      name: `번호중복검증-${organizationKey}`,
      accountType: "STUDENT",
      schoolId: cleanupSchoolId,
      schoolGroupId: classGroup.id,
      studentNumber: 6,
    }),
  });
  assert.equal(duplicateNumberOnboarding.status, 409, "같은 반에서 같은 번호로 가입할 수 없어야 합니다.");
  assert.match(await duplicateNumberOnboarding.text(), /이미 사용 중인 번호/u);

  const teacherScopedUsers = await fetch(`${baseUrl}/api/admin/users?page=1&pageSize=100&schoolId=school_cheonghak_high`, { headers: { Cookie: schoolTeacherCookie } });
  assert.equal(teacherScopedUsers.status, 200, "일반 교사는 자기 학교 사용자 목록을 조회할 수 있어야 합니다.");
  const teacherScopedResult = await teacherScopedUsers.json() as { users: { school: { id: string } | null }[] };
  assert.ok(teacherScopedResult.users.length > 0);
  assert.ok(teacherScopedResult.users.every((user) => user.school?.id === cleanupSchoolId), "교사가 다른 학교를 요청해도 자기 학교 명단만 반환해야 합니다.");

  const beforeStudentNumberChange = await prisma.user.findUniqueOrThrow({ where: { id: student.id }, select: { authVersion: true } });
  const teacherNumberChange = await fetch(`${baseUrl}/api/admin/users/${student.id}`, {
    method: "PATCH",
    headers: { Cookie: schoolTeacherCookie, Origin: requestOrigin, "Content-Type": "application/json" },
    body: JSON.stringify({ studentNumber: 7, reason: "일반 교사 학생 번호 변경 검증" }),
  });
  assert.equal(teacherNumberChange.status, 200, `일반 교사는 자기 학교 학생 번호를 변경할 수 있어야 합니다: ${await teacherNumberChange.clone().text()}`);
  const afterStudentNumberChange = await prisma.user.findUniqueOrThrow({ where: { id: student.id }, select: { studentNumber: true, authVersion: true } });
  assert.deepEqual(afterStudentNumberChange, { studentNumber: 7, authVersion: beforeStudentNumberChange.authVersion }, "번호 변경만으로 학생 세션을 끊으면 안 됩니다.");

  const teacherRoleChange = await fetch(`${baseUrl}/api/admin/users/${student.id}`, {
    method: "PATCH",
    headers: { Cookie: schoolTeacherCookie, Origin: requestOrigin, "Content-Type": "application/json" },
    body: JSON.stringify({ role: "TEACHER", reason: "일반 교사 권한 범위 검증" }),
  });
  assert.equal(teacherRoleChange.status, 403, "일반 교사는 학생 역할을 바꿀 수 없어야 합니다.");

  const outOfSchoolNumberChange = await fetch(`${baseUrl}/api/admin/users/${outOfSchoolStudentId}`, {
    method: "PATCH",
    headers: { Cookie: schoolTeacherCookie, Origin: requestOrigin, "Content-Type": "application/json" },
    body: JSON.stringify({ studentNumber: 98, reason: "타교 학생 번호 차단 검증" }),
  });
  assert.equal(outOfSchoolNumberChange.status, 403, "일반 교사는 타 학교 학생 번호를 바꿀 수 없어야 합니다.");

  const teacherGroupCreate = await fetch(`${baseUrl}/api/admin/schools/${cleanupSchoolId}/groups`, {
    method: "POST",
    headers: { Cookie: schoolTeacherCookie, Origin: requestOrigin, "Content-Type": "application/json" },
    body: JSON.stringify({ grade: 8, classNumber: 1, type: "CLASS" }),
  });
  assert.equal(teacherGroupCreate.status, 403, "일반 교사는 학급 구조를 변경할 수 없어야 합니다.");

  const studentInviteCandidates = await fetch(`${baseUrl}/api/boards/${firstStudentBoard.id}/members/candidates`, { headers: { Cookie: studentCookie } });
  assert.equal(studentInviteCandidates.status, 200, "학생 소유자는 자기 학급 안에서 초대 후보를 찾을 수 있어야 합니다.");
  assert.doesNotMatch(await studentInviteCandidates.text(), /loginIdentifierEncrypted|nameEncrypted|v1:/, "학생 초대 후보 응답에 암호문이 노출되면 안 됩니다.");

  // 이후 소속 CRUD 인원수 검증에는 이 독립 온보딩 검증 계정이 섞이지 않게 되돌립니다.
  await prisma.user.update({ where: { id: student.id }, data: { schoolId: null, schoolGroupId: null, studentNumber: null } });

  const classRename = await fetch(`${baseUrl}/api/admin/schools/${cleanupSchoolId}/groups/${classGroup.id}`, {
    method: "PATCH",
    headers: { Cookie: superCookie, Origin: requestOrigin, "Content-Type": "application/json" },
    body: JSON.stringify({ classNumber: 10 }),
  });
  assert.equal(classRename.status, 200, `전체관리자는 반 이름을 변경할 수 있어야 합니다: ${await classRename.clone().text()}`);

  const grade2ClassCreate = await fetch(`${baseUrl}/api/admin/schools/${cleanupSchoolId}/groups`, {
    method: "POST",
    headers: { Cookie: superCookie, Origin: requestOrigin, "Content-Type": "application/json" },
    body: JSON.stringify({ grade: 2, classNumber: 10, type: "CLASS" }),
  });
  assert.equal(grade2ClassCreate.status, 201);
  const grade2Class = (await grade2ClassCreate.json() as { group: { id: string } }).group;
  const temporaryIds = Array.from({ length: 11 }, () => randomUUID());
  temporaryIds.forEach((id) => cleanupUserIds.add(id));
  await prisma.user.createMany({
    data: temporaryIds.map((id, index) => {
      const email = `verify-page-${index}-${id}@invalid.local`;
      return {
        id,
        loginIdentifierLookup: createLoginIdentifierLookup(email),
        loginIdentifierEncrypted: encryptUserPii(id, "email", email),
        nameEncrypted: encryptOptionalUserPii(id, "name", `검증용 학생 ${index + 1}`),
        role: "STUDENT" as const,
        schoolId: cleanupSchoolId,
        schoolGroupId: classGroup.id,
      };
    }),
  });
  await prisma.boardMember.createMany({
    data: temporaryIds.map((userId) => ({
      boardId: verificationBoard.id,
      userId,
      role: "MEMBER" as const,
    })),
  });

  const firstOffsetPage = await fetch(`${baseUrl}/api/admin/users?page=1&pageSize=10&schoolId=${cleanupSchoolId}`, { headers: { Cookie: superCookie } });
  assert.equal(firstOffsetPage.status, 200, "첫 오프셋 페이지를 조회할 수 있어야 합니다.");
  const firstOffsetResult = await firstOffsetPage.json() as { users: { id: string }[]; totalCount: number; page: number; pageSize: number };
  assert.deepEqual({ count: firstOffsetResult.users.length, totalCount: firstOffsetResult.totalCount, page: firstOffsetResult.page, pageSize: firstOffsetResult.pageSize }, { count: 10, totalCount: 12, page: 1, pageSize: 10 });

  const secondOffsetPage = await fetch(`${baseUrl}/api/admin/users?page=2&pageSize=10&schoolId=${cleanupSchoolId}`, { headers: { Cookie: superCookie } });
  assert.equal(secondOffsetPage.status, 200, "두 번째 오프셋 페이지를 조회할 수 있어야 합니다.");
  const secondOffsetResult = await secondOffsetPage.json() as { users: { id: string }[]; totalCount: number; page: number };
  assert.deepEqual({ count: secondOffsetResult.users.length, totalCount: secondOffsetResult.totalCount, page: secondOffsetResult.page }, { count: 2, totalCount: 12, page: 2 });

  const teacherClassMembers = await fetch(`${baseUrl}/api/admin/schools/${cleanupSchoolId}/groups/${classGroup.id}/members?page=1&pageSize=5`, { headers: { Cookie: schoolTeacherCookie } });
  assert.equal(teacherClassMembers.status, 200, "일반 교사는 소속 관리에서 자기 학교 학급 학생을 펼쳐 볼 수 있어야 합니다.");

  const firstNumberTargetId = temporaryIds[1];
  const duplicateNumberTargetId = temporaryIds[2];
  const teacherAssignNumber = await fetch(`${baseUrl}/api/admin/users/${firstNumberTargetId}`, {
    method: "PATCH",
    headers: { Cookie: schoolTeacherCookie, Origin: requestOrigin, "Content-Type": "application/json" },
    body: JSON.stringify({ studentNumber: 18, reason: "소속 관리 학생 번호 지정 검증" }),
  });
  assert.equal(teacherAssignNumber.status, 200, "일반 교사는 번호가 없는 자기 학교 학생에게 번호를 지정할 수 있어야 합니다.");
  const teacherAssignDuplicateNumber = await fetch(`${baseUrl}/api/admin/users/${duplicateNumberTargetId}`, {
    method: "PATCH",
    headers: { Cookie: schoolTeacherCookie, Origin: requestOrigin, "Content-Type": "application/json" },
    body: JSON.stringify({ studentNumber: 18, reason: "소속 관리 번호 중복 차단 검증" }),
  });
  assert.equal(teacherAssignDuplicateNumber.status, 409, "같은 반에 같은 학생 번호를 중복 지정할 수 없어야 합니다.");
  assert.match(await teacherAssignDuplicateNumber.text(), /이미/u);

  const bulkSuspend = await fetch(`${baseUrl}/api/admin/users/bulk`, {
    method: "PATCH",
    headers: { Cookie: superCookie, Origin: requestOrigin, "Content-Type": "application/json" },
    body: JSON.stringify({ userIds: temporaryIds, status: "SUSPENDED", reason: "일괄 상태 변경 HTTP 검증" }),
  });
  assert.equal(bulkSuspend.status, 200, "전체관리자는 선택한 사용자를 일괄 수정할 수 있어야 합니다.");
  const bulkSuspendResult = await bulkSuspend.json() as { updated: string[]; skipped: unknown[] };
  assert.equal(bulkSuspendResult.updated.length, 11);
  assert.equal(bulkSuspendResult.skipped.length, 0);

  const temporaryId = temporaryIds[0];
  const bulkOrganization = await fetch(`${baseUrl}/api/admin/users/bulk`, {
    method: "PATCH",
    headers: { Cookie: superCookie, Origin: requestOrigin, "Content-Type": "application/json" },
    body: JSON.stringify({
      userIds: [temporaryId],
      role: "TEACHER",
      status: "ACTIVE",
      schoolId: cleanupSchoolId,
      schoolGroupId: departmentGroup.id,
      reason: "일괄 역할·소속 변경 HTTP 검증",
    }),
  });
  assert.equal(bulkOrganization.status, 200, "전체관리자는 역할과 소속을 함께 일괄 변경할 수 있어야 합니다.");
  const bulkOrganizationResult = await bulkOrganization.json() as { updated: string[]; skipped: unknown[] };
  assert.deepEqual(bulkOrganizationResult, { updated: [temporaryId], skipped: [] });

  const organizationCounts = await prisma.school.findUnique({
    where: { id: cleanupSchoolId },
    select: { _count: { select: { users: true } }, groups: { select: { id: true, _count: { select: { users: true } } } } },
  });
  assert.equal(organizationCounts?._count.users, 12, "학교 인원수는 전체 소속 인원을 반영해야 합니다.");
  assert.equal(organizationCounts?.groups.find((group) => group.id === classGroup.id)?._count.users, 10, "반 인원수가 반영되어야 합니다.");
  assert.equal(organizationCounts?.groups.find((group) => group.id === departmentGroup.id)?._count.users, 2, "부서 인원수가 반영되어야 합니다.");

  const classMembers = await fetch(`${baseUrl}/api/admin/schools/${cleanupSchoolId}/groups/${classGroup.id}/members?page=1&pageSize=5`, { headers: { Cookie: superCookie } });
  assert.equal(classMembers.status, 200, "소속 관리에서 학급 구성원을 펼쳐 볼 수 있어야 합니다.");
  const classMemberPage = await classMembers.json() as { members: unknown[]; totalCount: number; hasMore: boolean };
  assert.deepEqual({ count: classMemberPage.members.length, totalCount: classMemberPage.totalCount, hasMore: classMemberPage.hasMore }, { count: 5, totalCount: 10, hasMore: true });
  assert.doesNotMatch(JSON.stringify(classMemberPage), /loginIdentifierEncrypted|nameEncrypted|v1:/, "소속 구성원 응답에 암호문이 노출되면 안 됩니다.");

  const studentClassMembers = await fetch(`${baseUrl}/api/admin/schools/${cleanupSchoolId}/groups/${classGroup.id}/members`, { headers: { Cookie: studentCookie } });
  assert.equal(studentClassMembers.status, 403, "일반 학생은 소속 구성원 API를 조회할 수 없어야 합니다.");

  const grantRepresentative = await fetch(`${baseUrl}/api/admin/users/${schoolTeacher.id}`, {
    method: "PATCH",
    headers: { Cookie: superCookie, Origin: requestOrigin, "Content-Type": "application/json" },
    body: JSON.stringify({ isSchoolRepresentative: true, reason: "학교 대표교사 지정 검증" }),
  });
  assert.equal(grantRepresentative.status, 200, "전체관리자는 소속 관리에서 학교 대표교사를 지정할 수 있어야 합니다.");
  assert.equal(await prisma.user.findUniqueOrThrow({ where: { id: schoolTeacher.id }, select: { isSchoolRepresentative: true } }).then((user) => user.isSchoolRepresentative), true);
  schoolTeacherCookie = await sessionCookie(await prisma.user.findUniqueOrThrow({ where: { id: schoolTeacher.id }, select: { id: true, authVersion: true } }));

  const crossSchoolMove = await fetch(`${baseUrl}/api/admin/students/move`, {
    method: "PATCH",
    headers: { Cookie: schoolTeacherCookie, Origin: requestOrigin, "Content-Type": "application/json" },
    body: JSON.stringify({ userIds: [outOfSchoolStudentId], schoolGroupId: grade2Class.id, reason: "타교 학생 이동 차단 검증" }),
  });
  assert.equal(crossSchoolMove.status, 403, "학교 대표교사도 다른 학교 학생을 자기 학교로 이동시킬 수 없어야 합니다.");

  const moveStudents = await fetch(`${baseUrl}/api/admin/students/move`, {
    method: "PATCH",
    headers: { Cookie: schoolTeacherCookie, Origin: requestOrigin, "Content-Type": "application/json" },
    body: JSON.stringify({ userIds: [temporaryIds[1]], schoolGroupId: grade2Class.id, reason: "학생 반 이동 검증" }),
  });
  assert.equal(moveStudents.status, 200, `학교 대표교사는 학생을 다른 반으로 옮길 수 있어야 합니다: ${await moveStudents.clone().text()}`);
  const movedStudent = await prisma.user.findUniqueOrThrow({ where: { id: temporaryIds[1] }, select: { schoolGroupId: true, studentNumber: true } });
  assert.deepEqual(movedStudent, { schoolGroupId: grade2Class.id, studentNumber: 1 }, "반 이동 시 도착 반의 빈 번호를 자동 배정해야 합니다.");

  const suspendRepresentativeTeacher = await fetch(`${baseUrl}/api/admin/users/${schoolTeacher.id}`, {
    method: "PATCH",
    headers: { Cookie: superCookie, Origin: requestOrigin, "Content-Type": "application/json" },
    body: JSON.stringify({ status: "SUSPENDED", reason: "비활성 대표교사 자동 해제 검증" }),
  });
  assert.equal(suspendRepresentativeTeacher.status, 200, "전체관리자는 대표교사를 정지할 수 있어야 합니다.");
  assert.equal(
    await prisma.user.findUniqueOrThrow({ where: { id: schoolTeacher.id }, select: { isSchoolRepresentative: true } }).then((user) => user.isSchoolRepresentative),
    false,
    "정지된 교사의 학교 대표 권한은 자동 해제되어야 합니다.",
  );

  const classDelete = await fetch(`${baseUrl}/api/admin/schools/${cleanupSchoolId}/groups/${classGroup.id}`, {
    method: "DELETE",
    headers: { Cookie: superCookie, Origin: requestOrigin },
  });
  assert.equal(classDelete.status, 200, "전체관리자는 반을 삭제할 수 있어야 합니다.");
  const classDeleteResult = await classDelete.json() as { affectedUsers: number };
  assert.equal(classDeleteResult.affectedUsers, 9);

  const schoolDelete = await fetch(`${baseUrl}/api/admin/schools/${cleanupSchoolId}`, {
    method: "DELETE",
    headers: { Cookie: superCookie, Origin: requestOrigin },
  });
  assert.equal(schoolDelete.status, 200, "전체관리자는 기본 학교가 아닌 학교를 삭제할 수 있어야 합니다.");
  const schoolDeleteResult = await schoolDelete.json() as { affectedUsers: number };
  assert.equal(schoolDeleteResult.affectedUsers, 12);
  cleanupSchoolId = null;

  const detachedUsers = await prisma.user.count({ where: { id: { in: temporaryIds }, schoolId: null, schoolGroupId: null } });
  assert.equal(detachedUsers, 11, "소속 삭제 후 사용자 조직 연결은 모두 초기화되어야 합니다.");

  const defaultSchoolDelete = await fetch(`${baseUrl}/api/admin/schools/school_cheonghak_high`, {
    method: "DELETE",
    headers: { Cookie: superCookie, Origin: requestOrigin },
  });
  assert.equal(defaultSchoolDelete.status, 409, "서비스 초기 기본 학교는 삭제할 수 없어야 합니다.");

  const deleteUser = await fetch(`${baseUrl}/api/admin/users/${temporaryId}`, {
    method: "DELETE",
    headers: { Cookie: superCookie, Origin: requestOrigin, "Content-Type": "application/json" },
    body: JSON.stringify({ reason: "회원 삭제 HTTP 검증" }),
  });
  assert.equal(deleteUser.status, 200, "전체관리자는 소유 패드가 없는 회원을 삭제할 수 있어야 합니다.");
  const deletedUser = await prisma.user.findUnique({ where: { id: temporaryId }, select: { status: true, schoolId: true, schoolGroupId: true } });
  assert.deepEqual(deletedUser, { status: "DELETED", schoolId: null, schoolGroupId: null }, "삭제된 회원은 로그인 불가 상태가 되고 조직 연결이 제거되어야 합니다.");
  assert.equal(
    await prisma.boardMember.count({ where: { userId: temporaryId } }),
    0,
    "단일 삭제된 회원은 모든 패드 멤버십에서도 제거되어야 합니다.",
  );

  const bulkDeleteIds = temporaryIds.slice(1);
  const bulkDelete = await fetch(`${baseUrl}/api/admin/users/bulk`, {
    method: "DELETE",
    headers: { Cookie: superCookie, Origin: requestOrigin, "Content-Type": "application/json" },
    body: JSON.stringify({ userIds: bulkDeleteIds, reason: "회원 일괄 삭제 HTTP 검증" }),
  });
  assert.equal(bulkDelete.status, 200, "전체관리자는 소유 패드가 없는 회원을 일괄 삭제할 수 있어야 합니다.");
  const bulkDeleteResult = await bulkDelete.json() as { updated: string[]; deleted: string[]; skipped: unknown[] };
  assert.deepEqual(new Set(bulkDeleteResult.deleted), new Set(bulkDeleteIds));
  assert.deepEqual(new Set(bulkDeleteResult.updated), new Set(bulkDeleteIds));
  assert.equal(bulkDeleteResult.skipped.length, 0);
  const bulkDeletedCount = await prisma.user.count({ where: { id: { in: bulkDeleteIds }, status: "DELETED", schoolId: null, schoolGroupId: null } });
  assert.equal(bulkDeletedCount, bulkDeleteIds.length, "일괄 삭제된 회원도 로그인 불가 상태가 되고 조직 연결이 제거되어야 합니다.");
  assert.equal(
    await prisma.boardMember.count({ where: { userId: { in: bulkDeleteIds } } }),
    0,
    "일괄 삭제된 회원도 모든 패드 멤버십에서 제거되어야 합니다.",
  );

  const organizationAuditActions = await prisma.adminAuditLog.findMany({
    where: { actorId: verificationAdminId, action: { in: ["SCHOOL_CREATED", "SCHOOL_UPDATED", "SCHOOL_DELETED", "SCHOOL_GROUP_CREATED", "SCHOOL_GROUP_UPDATED", "SCHOOL_GROUP_DELETED"] } },
    select: { action: true },
  });
  const loggedActions = new Set(organizationAuditActions.map(({ action }) => action));
  for (const action of ["SCHOOL_CREATED", "SCHOOL_UPDATED", "SCHOOL_DELETED", "SCHOOL_GROUP_CREATED", "SCHOOL_GROUP_UPDATED", "SCHOOL_GROUP_DELETED"]) {
    assert.ok(loggedActions.has(action as typeof organizationAuditActions[number]["action"]), `${action} 감사 로그가 필요합니다.`);
  }

  console.log("admin_http_checks=passed anonymous=401 super_admin=200 teacher_student_number=own-school-only+unique school_dashboard=clean representative=grant+auto-revoke class_move=passed student_board_limit=10_concurrent_safe student_onboarding=grade+class+unique-number organization_members=lazy+paged pagination=10+2 bulk=passed organization_crud=passed delete=soft_deleted+memberships_removed bulk_delete=soft_deleted+memberships_removed");
}

main()
  .catch((error) => {
    console.error(error instanceof Error ? error.message : "관리자 HTTP 검증에 실패했습니다.");
    process.exitCode = 1;
  })
  .finally(async () => {
    const prisma = getPrisma();
    const userIds = [...cleanupUserIds];
    if (userIds.length) {
      await prisma.adminAuditLog.deleteMany({
        where: {
          OR: [
            { actorId: { in: userIds } },
            { targetUserId: { in: userIds } },
            { entityType: "User", entityId: { in: userIds } },
          ],
        },
      });
    }
    if (cleanupSchoolId) {
      await prisma.school.deleteMany({ where: { id: cleanupSchoolId } });
    }
    if (cleanupBoardIds.size) {
      await prisma.activity.deleteMany({ where: { board: { id: { in: [...cleanupBoardIds] } } } });
    }
    if (userIds.length) {
      await prisma.user.deleteMany({ where: { id: { in: userIds } } });
    }
    await prisma.$disconnect();
  });
