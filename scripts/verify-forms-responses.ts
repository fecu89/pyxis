import "../lib/load-env";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import ExcelJS from "exceljs";
import { createFormActivity, deleteFormFixture } from "./fixtures";
import { getPrisma } from "../lib/prisma";
import { buildFormSummary, gatherFormExportData, getFormResponseDetail, listFormResponses } from "../lib/forms/summary";
import { buildFormWorkbook } from "../lib/forms/xlsx";
import { listFormShares, removeFormShare, upsertFormShare, ShareTargetError } from "../lib/forms/shares";

// 5단계(응답 집계·XLSX·공유)를 HTTP 없이 직접 검증합니다. lib/forms/summary.ts·shares.ts는
// server-only이지만 순수하게 Prisma만 부르므로, verify-forms-save.ts처럼 함수를 곧바로
// 호출합니다 — HTTP가 필요한 건 라우트의 권한 판정뿐인데 그건 lib/forms/access.ts에서 이미
// 검증했습니다(save.ts·submit.ts와 같은 접근입니다).

const prisma = getPrisma();
type Fixture = { formId: string; activityId: string };
const fixtures: Fixture[] = [];

async function createForm(owner: string, title: string) {
  const activityId = await createFormActivity(prisma, owner, title);
  const form = await prisma.form.create({
    data: { ownerId: owner, activityId, slug: `verify-responses-${randomUUID()}`, title, status: "OPEN", requiresLogin: false },
    select: { id: true },
  });
  fixtures.push({ formId: form.id, activityId });
  return form.id;
}

async function addResponse(formId: string, respondentName: string | null, submittedAt: Date) {
  const response = await prisma.formResponse.create({
    data: { formId, respondentName, status: "SUBMITTED", submittedAt, dedupeKey: randomUUID() },
    select: { id: true },
  });
  await prisma.form.update({ where: { id: formId }, data: { responseCount: { increment: 1 } } });
  return response.id;
}

async function main() {
  // 공유 대상(teachers)이 role: TEACHER만 인정하므로, 소유자는 되도록 ADMIN·SUPER_ADMIN에서
  // 골라 TEACHER 계정 2명이 전부 공유 후보로 남게 합니다(이 배포의 실제 TEACHER 계정이 2명뿐).
  const owner = (await prisma.user.findFirst({ where: { status: "ACTIVE", role: { in: ["ADMIN", "SUPER_ADMIN"] } }, select: { id: true } }))
    ?? (await prisma.user.findFirst({ where: { status: "ACTIVE", role: "TEACHER" }, select: { id: true } }));
  if (!owner) throw new Error("검증에 사용할 활성 교사·관리자 계정이 없습니다.");
  const teachers = await prisma.user.findMany({ where: { status: "ACTIVE", role: "TEACHER", id: { not: owner.id } }, select: { id: true }, take: 2 });
  if (teachers.length < 2) throw new Error("검증에 사용할 활성 교사 계정이 (소유자 제외) 2명 이상 필요합니다.");
  const student = await prisma.user.findFirst({ where: { status: "ACTIVE", role: "STUDENT" }, select: { id: true } });
  if (!student) throw new Error("검증에 사용할 활성 학생 계정이 없습니다.");

  try {
    await checkChoiceSummaryWithRemovedOption(owner.id);
    await checkGridSummaryWithRenamedRow(owner.id);
    await checkScaleAndTextSummary(owner.id);
    await checkTypeChangeSummary(owner.id);
    await checkResponsePaginationAndLabels(owner.id);
    await checkResponseDetailIsolation(owner.id);
    await checkXlsxExport(owner.id);
    await checkShares(owner.id, teachers[0].id, teachers[1].id, student.id);

    console.log("forms_responses_checks=passed");
  } finally {
    for (const fixture of fixtures) {
      await deleteFormFixture(prisma, fixture.formId, fixture.activityId).catch(() => undefined);
    }
    await prisma.$disconnect();
  }
}

/** 보기를 지운 뒤에도(save.ts는 응답이 있어도 보기 삭제를 막지 않습니다) 그 응답이 "지워진 보기" 버킷으로 살아남는지. */
async function checkChoiceSummaryWithRemovedOption(owner: string) {
  const formId = await createForm(owner, "요약 검증: 객관식");
  const field = await prisma.formField.create({ data: { formId, type: "MULTIPLE_CHOICE", title: "학년", position: 0, required: true } });
  const [optionA, optionB, optionC] = await Promise.all([
    prisma.formFieldOption.create({ data: { fieldId: field.id, text: "1학년", position: 0 } }),
    prisma.formFieldOption.create({ data: { fieldId: field.id, text: "2학년", position: 1 } }),
    prisma.formFieldOption.create({ data: { fieldId: field.id, text: "3학년", position: 2 } }),
  ]);

  const now = new Date();
  const r1 = await addResponse(formId, null, now);
  const r2 = await addResponse(formId, null, now);
  const r3 = await addResponse(formId, null, now);
  await prisma.formAnswer.create({ data: { responseId: r1, fieldId: field.id, fieldType: "MULTIPLE_CHOICE", fieldTitle: "학년", selectedOptionIds: [optionA.id], selectedOptionTexts: ["1학년"] } });
  await prisma.formAnswer.create({ data: { responseId: r2, fieldId: field.id, fieldType: "MULTIPLE_CHOICE", fieldTitle: "학년", selectedOptionIds: [optionA.id], selectedOptionTexts: ["1학년"] } });
  await prisma.formAnswer.create({ data: { responseId: r3, fieldId: field.id, fieldType: "MULTIPLE_CHOICE", fieldTitle: "학년", selectedOptionIds: [optionC.id], selectedOptionTexts: ["3학년"] } });

  // 응답이 있는데도 보기를 지웁니다 — save.ts는 옵션 삭제 자체를 막지 않습니다(필드 삭제만 막습니다).
  await prisma.formFieldOption.delete({ where: { id: optionC.id } });

  const summary = await buildFormSummary(formId);
  const choiceField = summary.fields.find((f) => f.fieldId === field.id);
  assert.ok(choiceField && choiceField.kind === "CHOICE", "객관식 필드 요약이 CHOICE가 아닙니다.");
  if (choiceField?.kind !== "CHOICE") return;

  const byId = new Map(choiceField.options.map((option) => [option.optionId, option]));
  assert.equal(byId.get(optionA.id)?.count, 2, "현재 보기(1학년) 집계가 틀립니다.");
  assert.equal(byId.get(optionB.id)?.count, 0, "응답 없는 보기(2학년)도 0으로 나와야 합니다.");
  const removed = [...byId.values()].find((option) => option.removed);
  assert.ok(removed, "지워진 보기가 별도 버킷으로 남아야 합니다.");
  assert.equal(removed?.count, 1, "지워진 보기 집계가 틀립니다.");
  assert.equal(removed?.text, "3학년", "지워진 보기의 스냅샷 문구가 남아야 합니다.");
  assert.equal(choiceField.answeredCount, 3, "응답 수 집계가 틀립니다.");
  assert.equal(choiceField.skippedCount, 0, "건너뜀 집계가 틀립니다.");
}

/** 행 이름을 바꿔도(그리드 행에는 안정된 ID가 없습니다) 옛 응답이 사라지지 않고 그때 라벨로 남는지. */
async function checkGridSummaryWithRenamedRow(owner: string) {
  const formId = await createForm(owner, "요약 검증: 그리드");
  const field = await prisma.formField.create({
    data: { formId, type: "MULTIPLE_CHOICE_GRID", title: "만족도", position: 0, required: true, gridRows: ["수업", "숙제"] },
  });
  const [good, bad] = await Promise.all([
    prisma.formFieldOption.create({ data: { fieldId: field.id, text: "좋음", position: 0 } }),
    prisma.formFieldOption.create({ data: { fieldId: field.id, text: "나쁨", position: 1 } }),
  ]);

  const now = new Date();
  const r1 = await addResponse(formId, null, now);
  await prisma.formAnswer.create({
    data: {
      responseId: r1, fieldId: field.id, fieldType: "MULTIPLE_CHOICE_GRID", fieldTitle: "만족도",
      gridValue: [
        { row: 0, rowLabel: "수업", optionIds: [good.id], optionTexts: ["좋음"] },
        { row: 1, rowLabel: "숙제(옛 이름)", optionIds: [bad.id], optionTexts: ["나쁨"] },
      ],
    },
  });

  const summary = await buildFormSummary(formId);
  const gridField = summary.fields.find((f) => f.fieldId === field.id);
  assert.ok(gridField && gridField.kind === "GRID", "그리드 필드 요약이 GRID가 아닙니다.");
  if (gridField?.kind !== "GRID") return;

  const classRow = gridField.rows.find((row) => row.rowLabel === "수업");
  assert.ok(classRow, "현재 행(수업)이 있어야 합니다.");
  assert.equal(classRow?.options.find((option) => option.optionId === good.id)?.count, 1, "현재 행 집계가 틀립니다.");
  const homeworkRow = gridField.rows.find((row) => row.rowLabel === "숙제");
  assert.equal(homeworkRow?.options.reduce((sum, option) => sum + option.count, 0), 0, "현재 행(숙제)엔 응답이 없어야 합니다.");
  const oldRow = gridField.rows.find((row) => row.rowLabel === "숙제(옛 이름)");
  assert.ok(oldRow, "이름이 바뀐 옛 행의 응답이 사라지면 안 됩니다.");
  assert.equal(oldRow?.options.find((option) => option.optionId === bad.id)?.count, 1, "옛 행 집계가 틀립니다.");
}

async function checkScaleAndTextSummary(owner: string) {
  const formId = await createForm(owner, "요약 검증: 척도·텍스트");
  const scale = await prisma.formField.create({ data: { formId, type: "LINEAR_SCALE", title: "만족도", position: 0, required: true, scaleMin: 1, scaleMax: 5 } });
  const text = await prisma.formField.create({ data: { formId, type: "SHORT_TEXT", title: "한마디", position: 1, required: false } });

  const now = new Date();
  const values = [3, 5, 5];
  for (const value of values) {
    const responseId = await addResponse(formId, null, now);
    await prisma.formAnswer.create({ data: { responseId, fieldId: scale.id, fieldType: "LINEAR_SCALE", fieldTitle: "만족도", numberValue: value } });
  }
  const withText = await addResponse(formId, null, now);
  await prisma.formAnswer.create({ data: { responseId: withText, fieldId: scale.id, fieldType: "LINEAR_SCALE", fieldTitle: "만족도", numberValue: 1 } });
  await prisma.formAnswer.create({ data: { responseId: withText, fieldId: text.id, fieldType: "SHORT_TEXT", fieldTitle: "한마디", textValue: "재밌었어요" } });

  const summary = await buildFormSummary(formId);
  const scaleField = summary.fields.find((f) => f.fieldId === scale.id);
  assert.ok(scaleField?.kind === "SCALE");
  if (scaleField?.kind !== "SCALE") return;
  assert.equal(scaleField.average, (3 + 5 + 5 + 1) / 4, "평균 계산이 틀립니다.");
  assert.equal(scaleField.distribution.find((bucket) => bucket.value === 5)?.count, 2, "분포 집계가 틀립니다.");

  const textField = summary.fields.find((f) => f.fieldId === text.id);
  assert.ok(textField?.kind === "TEXT");
  if (textField?.kind !== "TEXT") return;
  assert.deepEqual(textField.sampleTexts, ["재밌었어요"], "자유 응답 목록이 틀립니다.");
  assert.equal(textField.answeredCount, 1, "텍스트 필드 응답 수가 틀립니다.");
  assert.equal(textField.skippedCount, 3, "텍스트 필드(선택)를 건너뛴 응답 수가 틀립니다.");
}

async function checkTypeChangeSummary(owner: string) {
  const formId = await createForm(owner, "요약 검증: 유형 변경");
  const field = await prisma.formField.create({ data: { formId, type: "SHORT_TEXT", title: "선호 이유", position: 0 } });
  const oldResponse = await addResponse(formId, null, new Date("2026-08-10T00:00:00Z"));
  await prisma.formAnswer.create({
    data: { responseId: oldResponse, fieldId: field.id, fieldType: "SHORT_TEXT", fieldTitle: "선호 이유", textValue: "예전 텍스트" },
  });

  await prisma.formField.update({ where: { id: field.id }, data: { type: "LINEAR_SCALE", title: "선호 점수", scaleMin: 1, scaleMax: 5 } });
  const newResponse = await addResponse(formId, null, new Date("2026-08-11T00:00:00Z"));
  await prisma.formAnswer.create({
    data: { responseId: newResponse, fieldId: field.id, fieldType: "LINEAR_SCALE", fieldTitle: "선호 점수", numberValue: 4 },
  });

  const summary = await buildFormSummary(formId);
  const current = summary.fields.find((item) => item.fieldId === field.id);
  const historical = summary.fields.find((item) => item.fieldId === `${field.id}:history:SHORT_TEXT`);
  assert.equal(current?.kind, "SCALE", "현재 유형 응답이 척도로 집계되지 않았습니다.");
  assert.equal(current?.answeredCount, 1, "이전 유형 답변이 현재 척도 응답 수에 섞였습니다.");
  assert.equal(current?.kind === "SCALE" ? current.average : null, 4, "현재 척도 평균이 틀렸습니다.");
  assert.equal(historical?.kind, "TEXT", "이전 단답형 응답이 별도 집계되지 않았습니다.");
  assert.deepEqual(historical?.kind === "TEXT" ? historical.sampleTexts : [], ["예전 텍스트"], "이전 유형 텍스트가 사라졌습니다.");
}

async function checkResponsePaginationAndLabels(owner: string) {
  const formId = await createForm(owner, "개별 응답 검증");
  const base = Date.now();
  await addResponse(formId, "홍길동", new Date(base));
  await addResponse(formId, null, new Date(base + 1000));
  await addResponse(formId, null, new Date(base + 2000));

  const page = await listFormResponses(formId, 1);
  assert.equal(page.totalCount, 3, "전체 응답 수가 틀립니다.");
  assert.equal(page.items.length, 3, "페이지 크기 안이라 3건이 모두 나와야 합니다.");
  // submittedAt 내림차순이라 가장 나중에 낸 응답(익명)이 먼저 옵니다.
  assert.equal(page.items[2].respondentLabel, "홍길동", "이름을 물은 응답은 그 이름이 나와야 합니다.");
  assert.ok(page.items[0].respondentLabel.startsWith("익명 응답"), "익명 응답은 번호가 붙어야 합니다.");
  assert.notEqual(page.items[0].respondentLabel, page.items[1].respondentLabel, "익명 응답끼리도 번호가 달라야 합니다.");
}

async function checkResponseDetailIsolation(owner: string) {
  const formA = await createForm(owner, "상세 격리 A");
  const formB = await createForm(owner, "상세 격리 B");
  const field = await prisma.formField.create({ data: { formId: formA, type: "SHORT_TEXT", title: "이름", position: 0, required: false } });
  const responseId = await addResponse(formA, "김철수", new Date());
  await prisma.formAnswer.create({ data: { responseId, fieldId: field.id, fieldType: "SHORT_TEXT", fieldTitle: "이름", textValue: "값" } });

  const ok = await getFormResponseDetail(formA, responseId);
  assert.ok(ok, "같은 폼의 응답 상세는 조회돼야 합니다.");
  assert.equal(ok?.answers[0]?.textValue, "값");

  const crossForm = await getFormResponseDetail(formB, responseId);
  assert.equal(crossForm, null, "다른 폼의 responseId로는 상세를 못 봐야 합니다.");
}

async function checkXlsxExport(owner: string) {
  const formId = await createForm(owner, "XLSX 검증");
  const field = await prisma.formField.create({ data: { formId, type: "SHORT_TEXT", title: "소감", position: 0, required: false } });
  const responseId = await addResponse(formId, "박영희", new Date());
  await prisma.formAnswer.create({ data: { responseId, fieldId: field.id, fieldType: "SHORT_TEXT", fieldTitle: "소감", textValue: "좋았어요" } });

  const data = await gatherFormExportData(formId);
  assert.equal(data.fieldTitles[0], "소감");
  // 내보내기 라벨은 XLSX 응답자 값과 ZIP 폴더명이 같아지도록 응답 ID 뒤 6자리를 항상
  // 붙인다(lib/forms/export-names.ts responseExportName).
  assert.equal(data.rows[0]?.respondentLabel, `박영희_${responseId.slice(-6)}`);
  assert.equal(data.rows[0]?.values[0], "좋았어요");

  const buffer = await buildFormWorkbook(data);
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(Buffer.from(buffer) as unknown as ExcelJS.Buffer);
  const sheet = workbook.getWorksheet("응답");
  assert.ok(sheet, "'응답' 시트가 있어야 합니다.");
  assert.equal(sheet?.getRow(1).getCell(3).value, "소감", "질문 제목이 헤더로 들어가야 합니다.");
  assert.equal(sheet?.getRow(2).getCell(3).value, "좋았어요", "응답 값이 셀로 들어가야 합니다.");
}

async function checkShares(owner: string, teacherA: string, teacherB: string, student: string) {
  const formId = await createForm(owner, "공유 검증");
  // scope 판정(teacherShareCandidateScope)에 필요한 최소 actor입니다. SUPER_ADMIN은 학교
  // 소속과 무관하게 전체 범위라, 아래 기존 단언들(전 플랫폼 후보·임의 교사 공유)이 실제 배포
  // DB의 학교 구성과 무관하게 그대로 유효합니다.
  const ownerActor = { id: owner, role: "SUPER_ADMIN" as const, systemPermissions: [], school: null };

  await upsertFormShare(formId, owner, ownerActor, teacherA, "VIEWER");
  let data = await listFormShares(formId, owner, ownerActor);
  assert.equal(data.shares.length, 1, "공유 목록에 1건이 있어야 합니다.");
  assert.equal(data.shares[0].permission, "VIEWER");
  assert.ok(!data.candidates.some((candidate) => candidate.id === owner), "후보 목록에 소유자 자신은 없어야 합니다.");

  // 재공유(업서트)는 권한만 바꿉니다 — 행이 늘어나면 안 됩니다.
  await upsertFormShare(formId, owner, ownerActor, teacherA, "EDITOR");
  data = await listFormShares(formId, owner, ownerActor);
  assert.equal(data.shares.length, 1, "같은 사람 재공유는 행을 늘리면 안 됩니다.");
  assert.equal(data.shares[0].permission, "EDITOR", "재공유는 권한을 덮어써야 합니다.");

  await assert.rejects(() => upsertFormShare(formId, owner, ownerActor, owner, "VIEWER"), ShareTargetError, "소유자 자신과는 공유할 수 없어야 합니다.");
  await assert.rejects(() => upsertFormShare(formId, owner, ownerActor, student, "VIEWER"), ShareTargetError, "학생과는 공유할 수 없어야 합니다.");

  await upsertFormShare(formId, owner, ownerActor, teacherB, "VIEWER");
  data = await listFormShares(formId, owner, ownerActor);
  assert.equal(data.shares.length, 2, "두 번째 공유 뒤 목록이 2건이어야 합니다.");

  await removeFormShare(formId, teacherA);
  data = await listFormShares(formId, owner, ownerActor);
  assert.equal(data.shares.length, 1, "제거 뒤 1건만 남아야 합니다.");
  assert.ok(!data.shares.some((share) => share.user.id === teacherA), "제거한 사람은 목록에서 빠져야 합니다.");

  const notification = await prisma.notification.findFirst({ where: { formId, userId: teacherB, type: "FORM_SHARED" } });
  assert.ok(notification, "공유하면 FORM_SHARED 알림이 만들어져야 합니다.");

  // 학교 scope: 존재하지 않는 학교에 소속된 교사 actor를 꾸미면 배포 DB의 모든 교사가
  // "학교 밖"이 됩니다 — 별도 학교·교사 픽스처 없이 범위 축소를 검증할 수 있습니다.
  const scopedActor = { id: owner, role: "TEACHER" as const, systemPermissions: [], school: { id: `verify-scope-${randomUUID()}` } };
  data = await listFormShares(formId, owner, scopedActor);
  assert.equal(data.candidates.length, 0, "학교 밖 교사는 공유 후보에 나오면 안 됩니다.");
  assert.equal(data.shares.length, 1, "기존 공유(teacherB)는 scope와 무관하게 목록에 남아야 합니다.");
  // teacherA는 위에서 공유를 제거해 share 행이 없으므로, 범위 밖 신규 공유로 거부되어야 합니다.
  await assert.rejects(() => upsertFormShare(formId, owner, scopedActor, teacherA, "VIEWER"), ShareTargetError, "학교 밖 교사와의 신규 공유는 거부되어야 합니다.");
  // teacherB는 share 행이 이미 있으므로 scope 밖이어도 권한 변경(업서트)이 허용되어야 합니다.
  await upsertFormShare(formId, owner, scopedActor, teacherB, "EDITOR");
  data = await listFormShares(formId, owner, ownerActor);
  assert.equal(data.shares.length, 1, "기존 공유 권한 변경은 행을 늘리면 안 됩니다.");
  assert.equal(data.shares[0].permission, "EDITOR", "기존 공유 대상은 scope 밖이어도 권한을 바꿀 수 있어야 합니다.");
}

void main().catch(async (error) => {
  console.error(error);
  await prisma.$disconnect();
  process.exit(1);
});
