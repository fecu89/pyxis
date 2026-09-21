import "../lib/load-env";

import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import {
  createLoginIdentifierLookup,
  createNicknameLookup,
  encryptOptionalUserPii,
  encryptUserLoginIdentifier,
} from "../lib/security/pii-crypto-core";
import { getPrisma } from "../lib/prisma";
import { getAssignableClassGroups, getAssignableStudentCandidates } from "../lib/quiz/assign-candidates";

/**
 * 퀴즈 할당 후보 조회(`lib/quiz/assign-candidates.ts`)가 학교 경계를 지키는지 검증합니다.
 *
 *   yarn verify:quiz-assign
 *
 * `getAssignableStudentCandidates`는 `lib/subjects/roster.ts`가 리팩터해 위임하는
 * `lib/users/student-search.ts`의 `searchActiveStudents`를 그대로 재사용합니다. 그 스캔
 * 검색·페이지네이션 자체(교과목 명단 합집합 포함)는 `yarn verify:roster-union`이 이미
 * 검증하므로 여기서 다시 반복하지 않고, 이 스크립트는 퀴즈 할당 전용 관심사 — 학교/학급
 * 범위 판정과 그 범위를 넘어선 접근 차단 — 만 다룹니다.
 *
 * 숫자 검색 테스트가 우연히 태그의 숫자와 겹치지 않도록, 태그는 숫자를 전부 알파벳으로
 * 치환해서 만듭니다(로그인 아이디에도 숫자를 넣지 않습니다) — 그래야 "출석번호 3번 검색"이
 * 정확히 그 학생 한 명만 찾는지를 흔들림 없이 확인할 수 있습니다.
 */
const prisma = getPrisma();
const rawTag = randomUUID().replaceAll("-", "");
const tag = rawTag.replace(/[0-9]/gu, (digit) => String.fromCharCode(97 + Number(digit))).slice(0, 8);

const created = {
  schoolAId: "",
  schoolBId: "",
  classA1Id: "",
  classA2Id: "",
  classBId: "",
  teacherAId: "",
  teacherNoSchoolId: "",
  userIds: [] as string[],
  students: {} as Record<"a1a" | "a1b" | "a2a" | "a2b" | "b1", string>,
};

async function seed() {
  const [schoolA, schoolB] = await Promise.all([
    prisma.school.create({ data: { name: `할당검증학교A-${tag}` } }),
    prisma.school.create({ data: { name: `할당검증학교B-${tag}` } }),
  ]);
  created.schoolAId = schoolA.id;
  created.schoolBId = schoolB.id;

  const [gradeA, gradeB] = await Promise.all([
    prisma.schoolGrade.create({ data: { schoolId: schoolA.id, grade: 1 } }),
    prisma.schoolGrade.create({ data: { schoolId: schoolB.id, grade: 1 } }),
  ]);

  const [classA1, classA2, classB] = await Promise.all([
    prisma.schoolGroup.create({ data: { schoolId: schoolA.id, name: `A반1-${tag}`, type: "CLASS", gradeId: gradeA.id, classNumber: 1 } }),
    prisma.schoolGroup.create({ data: { schoolId: schoolA.id, name: `A반2-${tag}`, type: "CLASS", gradeId: gradeA.id, classNumber: 2 } }),
    prisma.schoolGroup.create({ data: { schoolId: schoolB.id, name: `B반1-${tag}`, type: "CLASS", gradeId: gradeB.id, classNumber: 1 } }),
  ]);
  created.classA1Id = classA1.id;
  created.classA2Id = classA2.id;
  created.classBId = classB.id;

  const teacherAId = randomUUID();
  const teacherALogin = `qa${tag}teach`;
  await prisma.user.create({
    data: {
      id: teacherAId,
      loginIdentifierEncrypted: encryptUserLoginIdentifier(teacherAId, teacherALogin),
      loginIdentifierLookup: createLoginIdentifierLookup(teacherALogin),
      role: "TEACHER", status: "ACTIVE", schoolId: schoolA.id,
    },
  });
  created.teacherAId = teacherAId;
  created.userIds.push(teacherAId);

  const teacherNoSchoolId = randomUUID();
  const teacherNoSchoolLogin = `qa${tag}nosch`;
  await prisma.user.create({
    data: {
      id: teacherNoSchoolId,
      loginIdentifierEncrypted: encryptUserLoginIdentifier(teacherNoSchoolId, teacherNoSchoolLogin),
      loginIdentifierLookup: createLoginIdentifierLookup(teacherNoSchoolLogin),
      role: "TEACHER", status: "ACTIVE",
    },
  });
  created.teacherNoSchoolId = teacherNoSchoolId;
  created.userIds.push(teacherNoSchoolId);

  // A반1 2명 · A반2 2명 · B학교 1명. 이름은 서로 부분 문자열이 겹치지 않게 골라서 "이름 일부
  // 검색" 검증이 다른 학생과 흔들리지 않게 합니다. 로그인 아이디·이름 어디에도 숫자를 넣지
  // 않으므로, 숫자 검색어는 오직 출석번호(studentNumber)로만 매칭됩니다.
  const studentDefs = [
    { key: "a1a", schoolId: schoolA.id, groupId: classA1.id, number: 1, name: "김민준", login: `qa${tag}sone` },
    { key: "a1b", schoolId: schoolA.id, groupId: classA1.id, number: 2, name: "이서연", login: `qa${tag}stwo` },
    { key: "a2a", schoolId: schoolA.id, groupId: classA2.id, number: 3, name: "박도윤", login: `qa${tag}sthree` },
    { key: "a2b", schoolId: schoolA.id, groupId: classA2.id, number: 4, name: "최유진", login: `qa${tag}sfour` },
    { key: "b1", schoolId: schoolB.id, groupId: classB.id, number: 1, name: "한지호", login: `qa${tag}sfive` },
  ] as const;

  for (const def of studentDefs) {
    const studentId = randomUUID();
    await prisma.user.create({
      data: {
        id: studentId,
        loginIdentifierEncrypted: encryptUserLoginIdentifier(studentId, def.login),
        loginIdentifierLookup: createLoginIdentifierLookup(def.login),
        nameEncrypted: encryptOptionalUserPii(studentId, "name", def.name),
        nameLookup: createNicknameLookup(def.name),
        role: "STUDENT", status: "ACTIVE",
        schoolId: def.schoolId, schoolGroupId: def.groupId, studentNumber: def.number,
      },
    });
    created.students[def.key] = studentId;
    created.userIds.push(studentId);
  }
}

async function run() {
  await seed();
  const { a1a, a1b, a2a } = created.students;
  const teacherA = { id: created.teacherAId, role: "TEACHER" as const, systemPermissions: [] as never[], school: { id: created.schoolAId, name: "할당검증학교A" } };
  const teacherNoSchool = { id: created.teacherNoSchoolId, role: "TEACHER" as const, systemPermissions: [] as never[], school: null };

  // ① 학교 A 교사에게는 A의 반만 보인다
  const classGroups = await getAssignableClassGroups(teacherA as never);
  const classGroupIds = new Set(classGroups.map((group) => group.id));
  assert.ok(classGroupIds.has(created.classA1Id), "A반1이 학급 후보에 있어야 합니다");
  assert.ok(classGroupIds.has(created.classA2Id), "A반2가 학급 후보에 있어야 합니다");
  assert.ok(!classGroupIds.has(created.classBId), "B학교 학급은 후보에 없어야 합니다");
  const classA1Option = classGroups.find((group) => group.id === created.classA1Id);
  assert.ok(classA1Option, "A반1 옵션을 찾을 수 있어야 합니다");
  assert.equal(classA1Option?.studentCount, 2, "A반1의 활성 학생 수는 2명이어야 합니다");
  assert.equal(classA1Option?.gradeName, "1학년", "A반1의 학년 표시는 1학년이어야 합니다");
  assert.equal(
    Object.prototype.hasOwnProperty.call(classA1Option ?? {}, "schoolName"),
    false,
    "AssignClassOption에는 schoolName이 없어야 합니다 — 필터 라벨은 학년+반 이름으로 고정된 프론트 계약입니다",
  );

  // ② schoolGroupId로 필터링하면 그 반 학생만, totalCount도 일치한다
  const classA1Candidates = await getAssignableStudentCandidates(teacherA as never, { schoolGroupId: created.classA1Id, page: 1, pageSize: 50 });
  assert.equal(classA1Candidates.totalCount, 2, "A반1 필터 후보는 2명이어야 합니다");
  assert.deepEqual(
    new Set(classA1Candidates.students.map((student) => student.id)),
    new Set([a1a, a1b]),
    "A반1 필터 후보는 정확히 그 반 학생이어야 합니다",
  );

  // ③ 다른 학교(B)의 반 ID를 넘겨도 범위 where와 AND로 묶여 빈 결과가 된다(교차 학교 차단)
  const crossSchoolCandidates = await getAssignableStudentCandidates(teacherA as never, { schoolGroupId: created.classBId, page: 1, pageSize: 50 });
  assert.equal(crossSchoolCandidates.totalCount, 0, "다른 학교 반 ID로는 후보가 0명이어야 합니다");
  assert.equal(crossSchoolCandidates.students.length, 0, "다른 학교 반 ID로 반환되는 학생 배열도 비어 있어야 합니다");

  // ④ 이름 일부로 검색하면 매칭된다
  const nameSearch = await getAssignableStudentCandidates(teacherA as never, { search: "도윤", page: 1, pageSize: 50 });
  assert.equal(nameSearch.totalCount, 1, "이름 일부 검색은 1명만 찾아야 합니다");
  assert.equal(nameSearch.students[0]?.id, a2a, "이름 검색 결과는 박도윤이어야 합니다");

  // ⑤ 숫자만 입력하면 출석번호로 매칭된다
  const numberSearch = await getAssignableStudentCandidates(teacherA as never, { search: "3", page: 1, pageSize: 50 });
  assert.equal(numberSearch.totalCount, 1, "출석번호 3번은 1명만 있어야 합니다");
  assert.equal(numberSearch.students[0]?.id, a2a, "출석번호 검색 결과는 3번 학생이어야 합니다");

  // ⑥ 무소속(school null) 교사는 학급도 학생도 못 본다
  const noSchoolGroups = await getAssignableClassGroups(teacherNoSchool as never);
  assert.equal(noSchoolGroups.length, 0, "무소속 교사는 학급 후보가 없어야 합니다");
  const noSchoolCandidates = await getAssignableStudentCandidates(teacherNoSchool as never, { page: 1, pageSize: 50 });
  assert.equal(noSchoolCandidates.totalCount, 0, "무소속 교사는 학생 후보가 없어야 합니다");
  assert.equal(noSchoolCandidates.students.length, 0, "무소속 교사에게 반환되는 학생 배열도 비어 있어야 합니다");

  console.log("퀴즈 할당 후보 검증 통과 (학급 범위 · 반 필터 · 교차 학교 차단 · 이름/출석번호 검색 · 무소속 교사 포함)");
}

async function cleanup() {
  if (created.userIds.length) await prisma.user.deleteMany({ where: { id: { in: created.userIds } } });
  if (created.schoolAId) await prisma.school.deleteMany({ where: { id: created.schoolAId } });
  if (created.schoolBId) await prisma.school.deleteMany({ where: { id: created.schoolBId } });
}

run()
  .catch((error) => { console.error(error); process.exitCode = 1; })
  .finally(async () => { await cleanup(); await prisma.$disconnect(); });
