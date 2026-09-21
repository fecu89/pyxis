import "../lib/load-env";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import ExcelJS from "exceljs";
import { encode } from "next-auth/jwt";
import { hashUserPassword, verifyUserPassword } from "../lib/auth/password";
import { getPrisma } from "../lib/prisma";
import { normalizeStudentIdPrefix, StudentRosterError } from "../lib/users/student-roster";
import {
  createAuthSecurityLookup,
  createLoginIdentifierLookup,
  createNicknameLookup,
  encryptOptionalUserPii,
  encryptUserPii,
} from "../lib/security/pii-crypto-core";

const baseUrl = process.env.VERIFY_BASE_URL || "http://localhost:3001";
function requireAuthSecret() {
  const value = process.env.AUTH_SECRET;
  if (!value) throw new Error("AUTH_SECRET 환경 변수가 필요합니다.");
  return value;
}
const authSecret = requireAuthSecret();

const prisma = getPrisma();
const verificationKey = randomUUID().replaceAll("-", "");
const alphabeticKey = verificationKey
  .replace(/[0-9]/gu, (digit) => String.fromCharCode(97 + Number(digit)));
const adminId = randomUUID();
const representativeId = randomUUID();
const schoolName = `명단검증학교-${verificationKey.slice(0, 8)}`;
const prefix = `v${alphabeticKey.slice(0, 6)}1`;
const loginId = `${prefix}30106`;
// 초기 비밀번호는 아이디와 동일하다(lib/users/student-roster.ts — 한글 섞인 비밀번호 사고 이후 변경).
const initialPassword = loginId;
const representativePrefix = `r${alphabeticKey.slice(0, 6)}2`;
const representativeStudentLoginId = `${representativePrefix}30107`;
const clientIdentifier = `198.51.100.${Number.parseInt(verificationKey.slice(0, 2), 16) % 250 + 1}`;
const importedUserIds = new Set<string>();

async function sessionCookie(user: { id: string; authVersion: number }, passwordChangeRequired = false) {
  const token = await encode({
    secret: authSecret,
    maxAge: 300,
    token: {
      userId: user.id,
      authVersion: user.authVersion,
      sessionInvalid: false,
      onboardingCompleted: true,
      onboardingState: "COMPLETE",
      passwordChangeRequired,
    },
  });
  return `next-auth.session-token=${token}; __Secure-next-auth.session-token=${token}`;
}

async function rosterFile({
  targetSchool = schoolName,
  studentNumber = 6,
  name = "초아",
}: {
  targetSchool?: string;
  studentNumber?: number;
  name?: string;
} = {}) {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet("학생 명단");
  sheet.addRow(["학교", "학년", "반", "번호", "이름"]);
  sheet.addRow([targetSchool, 3, 1, studentNumber, name]);
  const data = await workbook.xlsx.writeBuffer();
  return new File(
    [new Uint8Array(data)],
    "verification-student-roster.xlsx",
    { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" },
  );
}

async function rosterRequest(
  cookie: string,
  mode: "preview" | "import",
  reason?: string,
  options: { targetSchool?: string; studentNumber?: number; name?: string; idPrefix?: string } = {},
) {
  const body = new FormData();
  body.set("file", await rosterFile(options));
  body.set("prefix", options.idPrefix ?? prefix);
  body.set("mode", mode);
  if (reason) body.set("reason", reason);
  return fetch(`${baseUrl}/api/admin/students/import`, {
    method: "POST",
    headers: { Cookie: cookie, Origin: baseUrl },
    body,
  });
}

async function main() {
  assert.equal(normalizeStudentIdPrefix("Ch1"), "ch1", "학생 아이디 접두어는 영문자·숫자를 허용하고 소문자로 정규화해야 합니다.");
  assert.throws(() => normalizeStudentIdPrefix("ch-1"), StudentRosterError, "학생 아이디 접두어에는 기호를 사용할 수 없어야 합니다.");

  const adminEmail = `roster-admin-${verificationKey}@invalid.local`;
  const adminName = `명단 검증 관리자 ${verificationKey.slice(0, 8)}`;
  const adminPasswordHash = await hashUserPassword(`Verify!${verificationKey.slice(0, 12)}9`);
  const admin = await prisma.user.create({
    data: {
      id: adminId,
      loginIdentifierLookup: createLoginIdentifierLookup(adminEmail),
      loginIdentifierEncrypted: encryptUserPii(adminId, "email", adminEmail),
      passwordHash: adminPasswordHash,
      nameEncrypted: encryptOptionalUserPii(adminId, "name", adminName),
      nameLookup: createNicknameLookup(adminName),
      role: "SUPER_ADMIN",
      onboardingCompletedAt: new Date(),
      lastLoginAt: new Date(),
    },
    select: { id: true, authVersion: true },
  });
  const adminCookie = await sessionCookie(admin);

  const rosterPage = await fetch(`${baseUrl}/admin/roster`, { headers: { Cookie: adminCookie } });
  assert.equal(rosterPage.status, 200, "학생 계정 발급 관리자 화면이 열려야 합니다.");
  const rosterPageHtml = await rosterPage.text();
  assert.match(rosterPageHtml, /학생 계정 발급/u);
  assert.match(rosterPageHtml, /Excel 명단 한 번으로 학교·학년·반과 학생 로그인 계정을 함께 만듭니다/u);
  assert.doesNotMatch(rosterPageHtml, /<details[^>]*student-roster-import/u, "학생 계정 발급 화면은 접힌 상세 영역이면 안 됩니다.");

  const anonymousTemplate = await fetch(`${baseUrl}/api/admin/students/import`);
  assert.equal(anonymousTemplate.status, 401, "비로그인 사용자는 명단 양식을 받을 수 없어야 합니다.");

  const template = await fetch(`${baseUrl}/api/admin/students/import`, { headers: { Cookie: adminCookie } });
  assert.equal(template.status, 200, "전체관리자는 명단 양식을 받을 수 있어야 합니다.");
  assert.match(template.headers.get("content-type") ?? "", /spreadsheetml/u);
  assert.equal(template.headers.get("x-content-type-options"), "nosniff");
  assert.ok((await template.arrayBuffer()).byteLength > 1_000, "명단 양식이 비어 있으면 안 됩니다.");

  const preview = await rosterRequest(adminCookie, "preview");
  assert.equal(preview.status, 200, `학생 명단 미리보기가 열려야 합니다: ${await preview.clone().text()}`);
  const previewBody = await preview.json() as {
    preview: {
      studentCount: number;
      newSchools: string[];
      newGradeCount: number;
      newClassCount: number;
      conflicts: unknown[];
      sample: Array<{ loginId: string }>;
    };
  };
  assert.deepEqual(
    {
      studentCount: previewBody.preview.studentCount,
      newSchools: previewBody.preview.newSchools,
      newGradeCount: previewBody.preview.newGradeCount,
      newClassCount: previewBody.preview.newClassCount,
      conflicts: previewBody.preview.conflicts.length,
      loginId: previewBody.preview.sample[0]?.loginId,
    },
    { studentCount: 1, newSchools: [schoolName], newGradeCount: 1, newClassCount: 1, conflicts: 0, loginId },
  );

  const imported = await rosterRequest(adminCookie, "import", "학생 명단 전체 흐름 자동 검증");
  assert.equal(imported.status, 201, `학생 명단 등록은 201이어야 합니다: ${await imported.clone().text()}`);
  assert.match(imported.headers.get("cache-control") ?? "", /no-store/u);
  const importedBody = await imported.json() as {
    importedCount: number;
    credentials: Array<{ loginId: string; initialPassword: string }>;
  };
  assert.equal(importedBody.importedCount, 1);
  assert.deepEqual(importedBody.credentials, [{
    loginId,
    initialPassword,
    schoolName,
    grade: 3,
    classNumber: 1,
    studentNumber: 6,
    name: "초아",
  }]);

  const student = await prisma.user.findUnique({
    where: { loginIdentifierLookup: createLoginIdentifierLookup(loginId) },
    select: {
      id: true,
      authVersion: true,
      passwordHash: true,
      mustChangePassword: true,
      role: true,
      status: true,
      studentNumber: true,
      onboardingCompletedAt: true,
      school: { select: { name: true } },
      schoolGroup: { select: { name: true, classNumber: true, grade: { select: { grade: true } } } },
    },
  });
  assert.ok(student, "등록한 학생을 DB에서 찾을 수 있어야 합니다.");
  importedUserIds.add(student.id);
  assert.deepEqual(
    {
      role: student.role,
      status: student.status,
      mustChangePassword: student.mustChangePassword,
      studentNumber: student.studentNumber,
      onboardingComplete: student.onboardingCompletedAt !== null,
      school: student.school?.name,
      group: student.schoolGroup,
    },
    {
      role: "STUDENT",
      status: "ACTIVE",
      mustChangePassword: true,
      studentNumber: 6,
      onboardingComplete: true,
      school: schoolName,
      group: { name: "3학년 1반", classNumber: 1, grade: { grade: 3 } },
    },
  );
  assert.equal(await verifyUserPassword(initialPassword, student.passwordHash), true, "초기 비밀번호 해시가 일치해야 합니다.");

  const conflict = await rosterRequest(adminCookie, "import", "중복 계정 방어 자동 검증");
  assert.equal(conflict.status, 409, "같은 명단을 다시 등록하면 전체 요청이 충돌로 중단되어야 합니다.");
  assert.equal(await prisma.user.count({ where: { loginIdentifierLookup: createLoginIdentifierLookup(loginId) } }), 1);

  const representativeEmail = `roster-representative-${verificationKey}@invalid.local`;
  const representativeName = `명단 검증 대표교사 ${verificationKey.slice(0, 8)}`;
  const representative = await prisma.user.create({
    data: {
      id: representativeId,
      loginIdentifierLookup: createLoginIdentifierLookup(representativeEmail),
      loginIdentifierEncrypted: encryptUserPii(representativeId, "email", representativeEmail),
      nameEncrypted: encryptOptionalUserPii(representativeId, "name", representativeName),
      nameLookup: createNicknameLookup(representativeName),
      role: "TEACHER",
      schoolId: student.school ? (await prisma.school.findUniqueOrThrow({ where: { name: schoolName }, select: { id: true } })).id : null,
      isSchoolRepresentative: false,
      onboardingCompletedAt: new Date(),
      lastLoginAt: new Date(),
    },
    select: { id: true, authVersion: true },
  });
  const representativeCookie = await sessionCookie(representative);
  const regularTeacherTemplate = await fetch(`${baseUrl}/api/admin/students/import`, { headers: { Cookie: representativeCookie } });
  assert.equal(regularTeacherTemplate.status, 403, "일반 교사는 학생 계정 발급 API를 사용할 수 없어야 합니다.");
  await prisma.user.update({
    where: { id: representative.id },
    data: { isSchoolRepresentative: true },
    select: { id: true },
  });
  const representativeTemplate = await fetch(`${baseUrl}/api/admin/students/import`, { headers: { Cookie: representativeCookie } });
  assert.equal(representativeTemplate.status, 200, "학교 대표교사는 학생 명단 양식을 받을 수 있어야 합니다.");

  const ownSchoolImport = await rosterRequest(
    representativeCookie,
    "import",
    "대표교사 자기 학교 학생 발급 검증",
    { idPrefix: representativePrefix, studentNumber: 7, name: "대표학생" },
  );
  assert.equal(ownSchoolImport.status, 201, `학교 대표교사는 자기 학교 학생만 발급할 수 있어야 합니다: ${await ownSchoolImport.clone().text()}`);
  const representativeStudent = await prisma.user.findUniqueOrThrow({
    where: { loginIdentifierLookup: createLoginIdentifierLookup(representativeStudentLoginId) },
    select: { id: true, school: { select: { name: true } }, studentNumber: true },
  });
  importedUserIds.add(representativeStudent.id);
  assert.deepEqual(
    { school: representativeStudent.school?.name, studentNumber: representativeStudent.studentNumber },
    { school: schoolName, studentNumber: 7 },
  );

  const outsideSchoolName = `${schoolName}-권한밖`;
  const outsideSchoolImport = await rosterRequest(
    representativeCookie,
    "import",
    "대표교사 다른 학교 발급 차단 검증",
    { targetSchool: outsideSchoolName, idPrefix: `x${alphabeticKey.slice(0, 6)}3`, studentNumber: 8, name: "권한밖학생" },
  );
  assert.equal(outsideSchoolImport.status, 403, "학교 대표교사는 다른 학교 학생을 발급할 수 없어야 합니다.");
  assert.match(await outsideSchoolImport.text(), /자기 학교|학생만 등록/u);
  assert.equal(await prisma.school.count({ where: { name: outsideSchoolName } }), 0, "권한 밖 학교가 부수적으로 생성되면 안 됩니다.");

  const reset = await fetch(`${baseUrl}/api/admin/users/${student.id}/password-reset`, {
    method: "POST",
    headers: { Cookie: adminCookie, Origin: baseUrl, "Content-Type": "application/json" },
    body: JSON.stringify({ reason: "관리자 비밀번호 초기화 자동 검증" }),
  });
  assert.equal(reset.status, 200, `관리자 비밀번호 초기화가 성공해야 합니다: ${await reset.clone().text()}`);
  assert.match(reset.headers.get("cache-control") ?? "", /no-store/u);
  const resetBody = await reset.json() as { temporaryPassword: string; authVersion: number };
  assert.match(resetBody.temporaryPassword, /^Px![A-Za-z0-9_-]{12}$/u);
  const resetStudent = await prisma.user.findUniqueOrThrow({
    where: { id: student.id },
    select: { id: true, authVersion: true, passwordHash: true, mustChangePassword: true },
  });
  assert.equal(resetStudent.authVersion, student.authVersion + 1, "초기화하면 이전 세션이 무효화되어야 합니다.");
  assert.equal(resetStudent.mustChangePassword, true);
  assert.equal(await verifyUserPassword(resetBody.temporaryPassword, resetStudent.passwordHash), true);
  assert.equal(await verifyUserPassword(initialPassword, resetStudent.passwordHash), false);

  const forcedCookie = await sessionCookie(resetStudent, true);
  const forcedDashboard = await fetch(`${baseUrl}/dashboard`, { headers: { Cookie: forcedCookie }, redirect: "manual" });
  assert.ok([302, 307, 308].includes(forcedDashboard.status), "최초 로그인 사용자는 대시보드 대신 비밀번호 변경으로 이동해야 합니다.");
  assert.match(forcedDashboard.headers.get("location") ?? "", /\/change-password\?next=%2Fdashboard/u);
  const forcedApi = await fetch(`${baseUrl}/api/boards`, { headers: { Cookie: forcedCookie } });
  assert.equal(forcedApi.status, 428, "최초 비밀번호 변경 전에는 일반 API를 사용할 수 없어야 합니다.");
  const forcedPage = await fetch(`${baseUrl}/change-password`, { headers: { Cookie: forcedCookie } });
  assert.equal(forcedPage.status, 200);
  assert.match(await forcedPage.text(), /처음 로그인하셨군요|새 비밀번호를 먼저 설정/u);

  const newPassword = `Safe!${verificationKey.slice(8, 20)}9Aa`;
  const changed = await fetch(`${baseUrl}/api/me/password`, {
    method: "POST",
    headers: {
      Cookie: forcedCookie,
      Origin: baseUrl,
      "Content-Type": "application/json",
      "X-Forwarded-For": clientIdentifier,
    },
    body: JSON.stringify({
      currentPassword: resetBody.temporaryPassword,
      newPassword,
      newPasswordConfirm: newPassword,
    }),
  });
  assert.equal(changed.status, 200, `최초 비밀번호 변경이 성공해야 합니다: ${await changed.clone().text()}`);
  const changedStudent = await prisma.user.findUniqueOrThrow({
    where: { id: student.id },
    select: { id: true, authVersion: true, passwordHash: true, mustChangePassword: true },
  });
  assert.equal(changedStudent.authVersion, resetStudent.authVersion + 1);
  assert.equal(changedStudent.mustChangePassword, false);
  assert.equal(await verifyUserPassword(newPassword, changedStudent.passwordHash), true);
  assert.equal(await verifyUserPassword(resetBody.temporaryPassword, changedStudent.passwordHash), false);

  const normalCookie = await sessionCookie(changedStudent, false);
  const normalDashboard = await fetch(`${baseUrl}/dashboard`, { headers: { Cookie: normalCookie }, redirect: "manual" });
  assert.equal(normalDashboard.status, 200, "새 비밀번호 설정 후 대시보드가 열려야 합니다.");

  const auditActions = new Set((await prisma.adminAuditLog.findMany({
    where: { actorId: adminId, action: { in: ["STUDENT_ROSTER_IMPORTED", "USER_PASSWORD_RESET"] } },
    select: { action: true },
  })).map(({ action }) => action));
  assert.deepEqual(auditActions, new Set(["STUDENT_ROSTER_IMPORTED", "USER_PASSWORD_RESET"]));

  // 학교 대표교사가 같은 학교 학생의 비밀번호를 무작위가 아니라 지정한 값으로 바꿀 수 있어야
  // 합니다(canManageStudent 재사용 확인) — 예전에는 assertCanRevokeTargetSessions 기준이라
  // 대표교사가 여기서 아예 막혔습니다.
  const chosenPassword = `Chosen!${verificationKey.slice(12, 20)}7Bb`;
  const representativeSet = await fetch(`${baseUrl}/api/admin/users/${student.id}/password-reset`, {
    method: "POST",
    headers: { Cookie: representativeCookie, Origin: baseUrl, "Content-Type": "application/json" },
    body: JSON.stringify({ reason: "대표교사 비밀번호 지정 자동 검증", password: chosenPassword }),
  });
  assert.equal(representativeSet.status, 200, `학교 대표교사가 같은 학교 학생의 비밀번호를 지정할 수 있어야 합니다: ${await representativeSet.clone().text()}`);
  const representativeSetBody = await representativeSet.json() as { authVersion: number; temporaryPassword?: string };
  assert.equal(representativeSetBody.temporaryPassword, undefined, "지정 비밀번호 응답에는 평문 비밀번호를 되돌려주지 않아야 합니다.");
  const representativeSetStudent = await prisma.user.findUniqueOrThrow({
    where: { id: student.id },
    select: { authVersion: true, passwordHash: true, mustChangePassword: true },
  });
  assert.equal(representativeSetStudent.mustChangePassword, true, "지정 비밀번호도 다음 로그인에 강제로 다시 바꾸게 해야 합니다.");
  assert.equal(await verifyUserPassword(chosenPassword, representativeSetStudent.passwordHash), true);
  assert.equal(representativeSetBody.authVersion, representativeSetStudent.authVersion);

  // 너무 약한 지정 비밀번호는 회원가입과 같은 기준으로 거부되어야 합니다.
  const weakSet = await fetch(`${baseUrl}/api/admin/users/${student.id}/password-reset`, {
    method: "POST",
    headers: { Cookie: representativeCookie, Origin: baseUrl, "Content-Type": "application/json" },
    body: JSON.stringify({ reason: "약한 비밀번호 지정 거부 검증", password: "1234" }),
  });
  assert.equal(weakSet.status, 400, "10자 미만 등 약한 비밀번호는 거부해야 합니다.");
  const stillChosenStudent = await prisma.user.findUniqueOrThrow({ where: { id: student.id }, select: { passwordHash: true } });
  assert.equal(await verifyUserPassword(chosenPassword, stillChosenStudent.passwordHash), true, "거부된 요청은 비밀번호를 바꾸면 안 됩니다.");

  const representativeAuditActions = new Set((await prisma.adminAuditLog.findMany({
    where: { actorId: representativeId, action: "USER_PASSWORD_SET" },
    select: { action: true },
  })).map(({ action }) => action));
  assert.deepEqual(representativeAuditActions, new Set(["USER_PASSWORD_SET"]));

  console.log("student_roster_checks=passed hierarchy=school>grade>class import=xlsx representative=own-school-only password=forced-change admin-reset=passed representative-password-set=passed");
}

main()
  .catch((error) => {
    console.error(error instanceof Error ? error.stack ?? error.message : "학생 명단 검증에 실패했습니다.");
    process.exitCode = 1;
  })
  .finally(async () => {
    const remainingImported = await prisma.user.findMany({
      where: { loginIdentifierLookup: { in: [createLoginIdentifierLookup(loginId), createLoginIdentifierLookup(representativeStudentLoginId)] } },
      select: { id: true },
    });
    remainingImported.forEach(({ id }) => importedUserIds.add(id));
    const userIds = [adminId, representativeId, ...importedUserIds];
    await prisma.adminAuditLog.deleteMany({
      where: { OR: [{ actorId: { in: [adminId, representativeId] } }, { targetUserId: { in: userIds } }] },
    });
    await prisma.authSecurityEvent.deleteMany({ where: { userId: { in: userIds } } });
    const ipLookup = createAuthSecurityLookup("ip", clientIdentifier);
    const ipRateKey = createAuthSecurityLookup("rate:login-ip-failure", ipLookup);
    await prisma.authRateLimit.deleteMany({ where: { key: ipRateKey } });
    if (importedUserIds.size) await prisma.user.deleteMany({ where: { id: { in: [...importedUserIds] } } });
    await prisma.school.deleteMany({ where: { name: schoolName } });
    await prisma.user.deleteMany({ where: { id: { in: [adminId, representativeId] } } });
    await prisma.$disconnect();
  });
