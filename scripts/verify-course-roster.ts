import "../lib/load-env";

import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { createLoginIdentifierLookup, encryptUserLoginIdentifier } from "../lib/security/pii-crypto-core";
import { getPrisma } from "../lib/prisma";
import { getCourseRoster, getCourseStudentCandidates, rosterMemberWhere } from "../lib/subjects/roster";

/**
 * 교과목 명단이 "개별 배정 ∪ 연결된 학급"으로 계산되는지 검증합니다.
 *
 * 이 합집합은 손으로 확인하기 어려운 종류의 규칙입니다 — 학생이 양쪽에 걸치면 두 번 세지면
 * 안 되고, 학급 연결은 살아 있어야 하며(반에 학생이 들어오면 자동 포함), 후보 목록에서는
 * 이미 명단에 든 학생이 빠져야 합니다. "개별 추가" UI가 학급을 먼저 고르게 하면서 생긴
 * `schoolGroupId` 후보 필터도 같은 규칙(다른 반 미혼입 · 이미 명단에 든 학생 제외)을
 * 지켜야 하므로 함께 검증합니다. 임시 데이터를 만들어 확인하고 끝나면 지웁니다.
 *
 *   yarn verify:roster-union
 */
const prisma = getPrisma();
const tag = randomUUID().slice(0, 8);
const created = { schoolId: "", gradeId: "", classAId: "", classBId: "", subjectId: "", teacherId: "", studentIds: [] as string[] };

async function seed() {
  const school = await prisma.school.create({ data: { name: `검증학교-${tag}` } });
  created.schoolId = school.id;
  const grade = await prisma.schoolGrade.create({ data: { schoolId: school.id, grade: 1 } });
  created.gradeId = grade.id;
  const [classA, classB] = await Promise.all([
    prisma.schoolGroup.create({ data: { schoolId: school.id, name: `1반-${tag}`, type: "CLASS", gradeId: grade.id, classNumber: 1 } }),
    prisma.schoolGroup.create({ data: { schoolId: school.id, name: `2반-${tag}`, type: "CLASS", gradeId: grade.id, classNumber: 2 } }),
  ]);
  created.classAId = classA.id;
  created.classBId = classB.id;

  const teacherId = randomUUID();
  const teacherLogin = `vt${tag}`;
  const teacher = await prisma.user.create({
    data: {
      id: teacherId,
      loginIdentifierEncrypted: encryptUserLoginIdentifier(teacherId, teacherLogin),
      loginIdentifierLookup: createLoginIdentifierLookup(teacherLogin),
      role: "TEACHER", status: "ACTIVE", schoolId: school.id,
    },
  });
  created.teacherId = teacher.id;

  // A반 3명, B반 2명.
  for (const [index, groupId] of [[1, classA.id], [2, classA.id], [3, classA.id], [4, classB.id], [5, classB.id]] as const) {
    const studentId = randomUUID();
    const studentLogin = `vs${index}${tag}`;
    const student = await prisma.user.create({
      data: {
        id: studentId,
        loginIdentifierEncrypted: encryptUserLoginIdentifier(studentId, studentLogin),
        loginIdentifierLookup: createLoginIdentifierLookup(studentLogin),
        role: "STUDENT", status: "ACTIVE",
        schoolId: school.id, schoolGroupId: groupId, studentNumber: index,
      },
    });
    created.studentIds.push(student.id);
  }

  const subject = await prisma.subject.create({
    data: { ownerId: teacher.id, name: `검증교과-${tag}`, nameNormalized: `검증교과-${tag}` },
  });
  created.subjectId = subject.id;
}

async function countRoster() {
  return prisma.user.count({ where: rosterMemberWhere(created.subjectId) });
}

async function run() {
  await seed();
  const [a1, a2, a3, b1] = created.studentIds;

  assert.equal(await countRoster(), 0, "새 교과목의 명단은 비어 있어야 합니다");

  // ① 학급 연결 → 그 반 전원이 명단에 든다
  await prisma.subjectSchoolGroup.create({ data: { subjectId: created.subjectId, schoolGroupId: created.classAId, assignedById: created.teacherId } });
  assert.equal(await countRoster(), 3, "A반을 연결하면 3명이어야 합니다");

  // ② 개별 배정이 겹쳐도 두 번 세지 않는다
  await prisma.subjectStudent.create({ data: { subjectId: created.subjectId, studentId: a1, assignedById: created.teacherId } });
  assert.equal(await countRoster(), 3, "이미 학급으로 들어온 학생을 개별 배정해도 3명이어야 합니다");

  // ③ 다른 반 학생을 개별로 더한다
  await prisma.subjectStudent.create({ data: { subjectId: created.subjectId, studentId: b1, assignedById: created.teacherId } });
  assert.equal(await countRoster(), 4, "B반 학생 1명을 개별 배정하면 4명이어야 합니다");

  // ④ 연결은 살아 있다 — 새 학생이 A반에 들어오면 자동으로 명단에 든다
  const newcomerId = randomUUID();
  const newcomerLogin = `vn${tag}`;
  const newcomer = await prisma.user.create({
    data: {
      id: newcomerId,
      loginIdentifierEncrypted: encryptUserLoginIdentifier(newcomerId, newcomerLogin),
      loginIdentifierLookup: createLoginIdentifierLookup(newcomerLogin),
      role: "STUDENT", status: "ACTIVE", schoolId: created.schoolId, schoolGroupId: created.classAId, studentNumber: 9,
    },
  });
  created.studentIds.push(newcomer.id);
  assert.equal(await countRoster(), 5, "A반에 전학생이 오면 자동으로 명단에 들어야 합니다");

  // ⑤ 정지된 학생은 빠진다
  await prisma.user.update({ where: { id: a2 }, data: { status: "SUSPENDED" } });
  assert.equal(await countRoster(), 4, "정지된 학생은 명단에서 빠져야 합니다");
  await prisma.user.update({ where: { id: a2 }, data: { status: "ACTIVE" } });

  // ⑥ 페이지네이션과 출처 표시
  const page = await getCourseRoster(created.subjectId, { page: 1, pageSize: 3 });
  assert.equal(page.totalCount, 5, "총원은 5명이어야 합니다");
  assert.equal(page.students.length, 3, "페이지 크기 3이면 3명만 와야 합니다");
  const direct = page.students.find((student) => student.id === a1);
  if (direct) assert.ok(direct.sources.includes("DIRECT"), "개별 배정된 학생은 DIRECT로 표시돼야 합니다");
  const groupOnly = page.students.find((student) => student.id === a3);
  if (groupOnly) assert.ok(groupOnly.sources.includes("GROUP"), "학급으로만 들어온 학생은 GROUP이어야 합니다");

  // ⑦ 후보에서는 이미 명단에 든 학생이 빠진다
  const actor = {
    id: created.teacherId, role: "TEACHER" as const, systemPermissions: [] as never[],
    school: { id: created.schoolId, name: "검증학교" },
  };
  const candidates = await getCourseStudentCandidates(created.subjectId, actor as never, { page: 1, pageSize: 50 });
  const candidateIds = new Set(candidates.students.map((student) => student.id));
  assert.ok(!candidateIds.has(a1), "이미 명단에 든 학생은 후보에 없어야 합니다");
  assert.ok(candidateIds.has(created.studentIds[4]), "아직 안 들어온 B반 학생은 후보에 있어야 합니다");

  // ⑧ 학급을 **여러 개** 연결할 수 있다. A반은 이미 걸려 있고 B반을 더한다.
  await prisma.subjectSchoolGroup.create({ data: { subjectId: created.subjectId, schoolGroupId: created.classBId, assignedById: created.teacherId } });
  const linkCount = await prisma.subjectSchoolGroup.count({ where: { subjectId: created.subjectId } });
  assert.equal(linkCount, 2, "학급 연결은 여러 개일 수 있어야 합니다");
  // A반 4명(전학생 포함) + B반 2명. b1은 개별 배정이면서 B반이라 합집합에서 한 번만 셉니다.
  assert.equal(await countRoster(), 6, "두 학급을 연결하면 양쪽 학생이 모두 명단에 들어야 합니다");

  // ⑨ 한 학급만 끊으면 나머지 연결은 그대로 남는다
  await prisma.subjectSchoolGroup.deleteMany({ where: { subjectId: created.subjectId, schoolGroupId: created.classAId } });
  assert.equal(await prisma.subjectSchoolGroup.count({ where: { subjectId: created.subjectId } }), 1, "B반 연결은 남아 있어야 합니다");
  // B반 2명 + 개별 배정 a1(A반이지만 개별로도 걸려 있음). b1은 B반이라 중복 없이 한 번.
  assert.equal(await countRoster(), 3, "A반 연결만 끊으면 B반 학생과 개별 배정만 남아야 합니다");

  // ⑩ "학생 개별 추가" UI는 이제 학급을 먼저 골라야 후보가 뜬다 — schoolGroupId 필터가
  // 그 반 학생만 돌려주고, 이미 명단에 든 학생은 (개별 배정이든 연결된 학급이든) 여전히
  // 빠지는지 확인합니다.
  //
  // 지금 상태: A반 연결은 끊겼고(⑨) B반 연결만 남아 있으며, 개별 배정은 a1·b1뿐입니다.
  const classACandidates = await getCourseStudentCandidates(created.subjectId, actor as never, {
    schoolGroupId: created.classAId, page: 1, pageSize: 50,
  });
  const classACandidateIds = new Set(classACandidates.students.map((student) => student.id));
  assert.equal(classACandidates.totalCount, 3, "A반 필터 후보의 totalCount는 3명(a2·a3·전학생)이어야 합니다");
  assert.equal(classACandidates.students.length, 3, "A반 필터로 반환된 학생도 3명이어야 합니다");
  assert.deepEqual(
    classACandidateIds,
    new Set([a2, a3, newcomer.id]),
    "A반 필터 후보는 정확히 a2·a3·전학생이어야 합니다(a1은 개별 배정으로 이미 명단에 있어 제외)",
  );
  for (const student of classACandidates.students) {
    assert.equal(student.className, `1반-${tag}`, "A반으로 필터링하면 다른 반 학생이 섞이면 안 됩니다");
  }

  // B반은 아직 이 subject에 연결돼 있고(⑧에서 연결, ⑨는 A반만 끊음) 그 학생 전원이 이미
  // 명단에 있으므로, B반으로 필터링하면 후보가 0명이어야 합니다 — 연결된 학급을 통해
  // 들어온 학생도 후보에서 빠진다는 뜻입니다.
  const classBCandidates = await getCourseStudentCandidates(created.subjectId, actor as never, {
    schoolGroupId: created.classBId, page: 1, pageSize: 50,
  });
  assert.equal(classBCandidates.totalCount, 0, "B반은 이미 전원 명단에 있어 필터 후보의 totalCount가 0이어야 합니다");
  assert.equal(classBCandidates.students.length, 0, "B반 필터로 반환된 학생도 0명이어야 합니다");

  console.log("교과목 명단 합집합 검증 통과 (11개 항목 · 다중 학급 연결 · 학급 필터 후보 조회 포함)");
}

async function cleanup() {
  if (created.subjectId) await prisma.subject.deleteMany({ where: { id: created.subjectId } });
  if (created.studentIds.length) await prisma.user.deleteMany({ where: { id: { in: created.studentIds } } });
  if (created.teacherId) await prisma.user.deleteMany({ where: { id: created.teacherId } });
  if (created.schoolId) await prisma.school.deleteMany({ where: { id: created.schoolId } });
}

run()
  .catch((error) => { console.error(error); process.exitCode = 1; })
  .finally(async () => { await cleanup(); await prisma.$disconnect(); });
