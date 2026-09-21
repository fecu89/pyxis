import "../lib/load-env";

import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { getReportStudentPage, getStudentFormResponseHistory, getStudentPadPostHistory } from "../lib/activity/students";
import { getPageNumbers } from "../lib/pagination";
import { getPrisma } from "../lib/prisma";
import {
  createLoginIdentifierLookup,
  createNicknameLookup,
  encryptOptionalUserPii,
  encryptUserLoginIdentifier,
} from "../lib/security/pii-crypto-core";
import { createFormActivity, createPadActivity } from "./fixtures";

const prisma = getPrisma();
const tag = randomUUID().replaceAll("-", "").slice(0, 10);
const created = { schoolIds: [] as string[], userIds: [] as string[], activityIds: [] as string[] };

async function createUser(input: {
  role: "TEACHER" | "STUDENT";
  schoolId: string;
  schoolGroupId?: string;
  studentNumber?: number;
  name: string;
}) {
  const id = randomUUID();
  const login = `report${tag}${created.userIds.length}`;
  await prisma.user.create({
    data: {
      id,
      loginIdentifierEncrypted: encryptUserLoginIdentifier(id, login),
      loginIdentifierLookup: createLoginIdentifierLookup(login),
      nameEncrypted: encryptOptionalUserPii(id, "name", input.name),
      nameLookup: createNicknameLookup(input.name),
      role: input.role,
      status: "ACTIVE",
      schoolId: input.schoolId,
      schoolGroupId: input.schoolGroupId,
      studentNumber: input.studentNumber,
    },
  });
  created.userIds.push(id);
  return id;
}

async function createBoard(ownerId: string, title: string, deletedAt: Date | null = null) {
  const activityId = await createPadActivity(prisma, ownerId, title);
  created.activityIds.push(activityId);
  const board = await prisma.board.create({
    data: { slug: `report-${tag}-${created.activityIds.length}`, title, ownerId, activityId, deletedAt },
  });
  const section = await prisma.section.create({ data: { boardId: board.id, title: "생각 나누기", position: 0 } });
  return { board, section };
}

async function createForm(ownerId: string, title: string, deletedAt: Date | null = null) {
  const activityId = await createFormActivity(prisma, ownerId, title);
  created.activityIds.push(activityId);
  const form = await prisma.form.create({
    data: { slug: `report-form-${tag}-${created.activityIds.length}`, title, ownerId, activityId, status: "OPEN", deletedAt },
  });
  const field = await prisma.formField.create({ data: { formId: form.id, type: "SHORT_TEXT", title: "수업 소감", position: 0 } });
  return { form, field };
}

async function run() {
  const [schoolA, schoolB] = await Promise.all([
    prisma.school.create({ data: { name: `학생리포트학교A-${tag}` } }),
    prisma.school.create({ data: { name: `학생리포트학교B-${tag}` } }),
  ]);
  created.schoolIds.push(schoolA.id, schoolB.id);

  const [gradeA, gradeB] = await Promise.all([
    prisma.schoolGrade.create({ data: { schoolId: schoolA.id, grade: 1 } }),
    prisma.schoolGrade.create({ data: { schoolId: schoolB.id, grade: 1 } }),
  ]);
  const [classA1, classA2, classB] = await Promise.all([
    prisma.schoolGroup.create({ data: { schoolId: schoolA.id, gradeId: gradeA.id, classNumber: 1, name: "1학년 1반", type: "CLASS" } }),
    prisma.schoolGroup.create({ data: { schoolId: schoolA.id, gradeId: gradeA.id, classNumber: 2, name: "1학년 2반", type: "CLASS" } }),
    prisma.schoolGroup.create({ data: { schoolId: schoolB.id, gradeId: gradeB.id, classNumber: 1, name: "1학년 1반", type: "CLASS" } }),
  ]);

  const teacherId = await createUser({ role: "TEACHER", schoolId: schoolA.id, name: `검증교사${tag}` });
  const studentA1Id = await createUser({ role: "STUDENT", schoolId: schoolA.id, schoolGroupId: classA1.id, studentNumber: 1, name: `검증학생가${tag}` });
  const studentA2Id = await createUser({ role: "STUDENT", schoolId: schoolA.id, schoolGroupId: classA2.id, studentNumber: 1, name: `검증학생나${tag}` });
  await createUser({ role: "STUDENT", schoolId: schoolB.id, schoolGroupId: classB.id, studentNumber: 1, name: `검증학생다${tag}` });

  const visible = await createBoard(teacherId, "보이는 패드");
  const archived = await createBoard(teacherId, "보관된 패드", new Date());
  const firstPost = await prisma.post.create({
    data: { boardId: visible.board.id, sectionId: visible.section.id, authorId: studentA1Id, title: "첫 글", body: "학생이 작성한 본문", status: "PUBLISHED", position: 0 },
  });
  await prisma.post.create({
    data: { boardId: visible.board.id, sectionId: visible.section.id, authorId: studentA1Id, title: "검토 중인 글", body: "승인을 기다립니다", status: "PENDING", position: 1 },
  });
  await prisma.post.create({
    data: { boardId: visible.board.id, sectionId: visible.section.id, authorId: studentA1Id, title: "삭제한 글", status: "PUBLISHED", position: 2, deletedAt: new Date() },
  });
  await prisma.post.create({
    data: { boardId: archived.board.id, sectionId: archived.section.id, authorId: studentA1Id, title: "보관 패드 글", status: "PUBLISHED", position: 0 },
  });
  await prisma.post.create({
    data: { boardId: visible.board.id, sectionId: visible.section.id, authorId: studentA2Id, title: "다른 반 글", status: "PUBLISHED", position: 3 },
  });

  const visibleForm = await createForm(teacherId, "수업 만족도 설문");
  const deletedForm = await createForm(teacherId, "삭제된 설문", new Date());
  const submittedResponse = await prisma.formResponse.create({
    data: { formId: visibleForm.form.id, respondentId: studentA1Id, status: "SUBMITTED", submittedAt: new Date() },
  });
  await prisma.formAnswer.create({
    data: { responseId: submittedResponse.id, fieldId: visibleForm.field.id, fieldType: "SHORT_TEXT", fieldTitle: "수업 소감", textValue: "다음 시간도 기대돼요" },
  });
  await prisma.formResponse.create({
    data: { formId: visibleForm.form.id, respondentId: studentA1Id, status: "IN_PROGRESS", submittedAt: null },
  });
  const deletedFormResponse = await prisma.formResponse.create({
    data: { formId: deletedForm.form.id, respondentId: studentA1Id, status: "SUBMITTED", submittedAt: new Date() },
  });
  await prisma.formAnswer.create({
    data: { responseId: deletedFormResponse.id, fieldId: deletedForm.field.id, fieldType: "SHORT_TEXT", fieldTitle: "수업 소감", textValue: "숨겨져야 하는 답변" },
  });

  const teacher = { id: teacherId, role: "TEACHER" as const, systemPermissions: [], school: { id: schoolA.id, name: schoolA.name } } as never;
  const allStudents = await getReportStudentPage(teacher);
  assert.deepEqual(new Set(allStudents.schoolGroups.map((group) => group.id)), new Set([classA1.id, classA2.id]), "같은 학교 학급만 필터에 보여야 합니다.");
  assert.equal(allStudents.students.find((student) => student.id === studentA1Id)?.postCount, 2, "삭제 글과 보관 패드 글을 제외한 실제 작성 글 수여야 합니다.");
  assert.equal(allStudents.students.find((student) => student.id === studentA1Id)?.formResponseCount, 1, "제출 완료한 활성 설문 응답만 세어야 합니다.");

  const classPage = await getReportStudentPage(teacher, { schoolGroupId: classA1.id });
  assert.equal(classPage.total, 1, "학급 필터는 해당 반 학생만 세어야 합니다.");
  assert.equal(classPage.students[0]?.id, studentA1Id, "학급 필터 결과가 해당 반 학생이어야 합니다.");
  const otherSchoolPage = await getReportStudentPage(teacher, { schoolGroupId: classB.id });
  assert.equal(otherSchoolPage.total, 0, "다른 학교 학급 ID로 학생을 조회할 수 없어야 합니다.");
  const partialNamePage = await getReportStudentPage(teacher, { query: "학생가" });
  assert.equal(partialNamePage.students[0]?.id, studentA1Id, "학생 이름 부분 검색이 동작해야 합니다.");
  const recoveredPage = await getReportStudentPage(teacher, { page: 999 });
  assert.equal(recoveredPage.page, 1, "범위를 벗어난 페이지는 마지막 유효 페이지로 보정해야 합니다.");
  assert.ok(recoveredPage.students.length > 0, "범위를 벗어난 페이지 번호 때문에 학생 목록이 비면 안 됩니다.");

  const posts = await getStudentPadPostHistory(studentA1Id);
  assert.equal(posts.length, 2, "상세 기록도 목록의 작성 글 기준과 일치해야 합니다.");
  assert.ok(posts.some((post) => post.status === "PENDING"), "승인 대기 글도 작성 기록에 보여야 합니다.");
  assert.equal(posts.find((post) => post.id === firstPost.id)?.href, `/b/${visible.board.slug}/posts/${firstPost.id}`, "패드 글 상세 링크가 만들어져야 합니다.");

  const formResponses = await getStudentFormResponseHistory(studentA1Id);
  assert.equal(formResponses.length, 1, "진행 중 응답과 삭제된 설문 응답은 학생 기록에서 제외해야 합니다.");
  assert.equal(formResponses[0]?.formTitle, "수업 만족도 설문", "학생이 제출한 설문 제목이 보여야 합니다.");
  assert.equal(formResponses[0]?.answers[0]?.fieldTitle, "수업 소감", "응답 시점의 문항 제목을 가져와야 합니다.");
  assert.equal(formResponses[0]?.answers[0]?.value, "다음 시간도 기대돼요", "학생이 제출한 답변 내용을 가져와야 합니다.");

  assert.deepEqual(getPageNumbers(1, 12), [1, 2, 3, 4, 5, "ellipsis", 12]);
  assert.deepEqual(getPageNumbers(6, 12), [1, "ellipsis", 5, 6, 7, "ellipsis", 12]);
  assert.deepEqual(getPageNumbers(12, 12), [1, "ellipsis", 8, 9, 10, 11, 12]);

  console.log("학생 리포트 검증 통과 (패드 글 · 설문 응답 내용 · 학급 필터 · 번호형 페이지네이션)");
}

async function cleanup() {
  await prisma.formAnswer.deleteMany({ where: { response: { respondentId: { in: created.userIds } } } });
  if (created.activityIds.length) await prisma.activity.deleteMany({ where: { id: { in: created.activityIds } } });
  if (created.userIds.length) await prisma.user.deleteMany({ where: { id: { in: created.userIds } } });
  if (created.schoolIds.length) await prisma.school.deleteMany({ where: { id: { in: created.schoolIds } } });
}

run()
  .catch((error) => { console.error(error); process.exitCode = 1; })
  .finally(async () => { await cleanup(); await prisma.$disconnect(); });
