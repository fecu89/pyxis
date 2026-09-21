import "../lib/load-env";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { createFormActivity, deleteFormFixture } from "./fixtures";
import { getPrisma } from "../lib/prisma";
import { ConflictSaveError, DestructiveSaveError, saveFormDocument } from "../lib/forms/save";
import { formSaveSchema, type FormSaveInput } from "../lib/forms/field-schema";

// 편집기의 전체 문서 저장(PUT)이 실제 PostgreSQL에서 무엇을 보존하고 무엇을 거부하는지
// 확인합니다.
//
//   NODE_OPTIONS=--conditions=react-server yarn verify:forms-save
//
// 여기서 잡으려는 것은 전부 "화면으로는 안 보이는" 종류입니다 — 보기 ID가 조용히 바뀌어
// 과거 응답 집계가 0이 되는 것, 유형을 바꿨는데 이전 유형 열이 남아 렌더를 오염시키는 것,
// 응답이 달린 질문이 확인 없이 지워지는 것.

const prisma = getPrisma();

/** 스키마를 통과한 저장 입력. 라우트가 zod로 검사한 뒤 넘기는 것과 같은 모양입니다. */
function saveInput(fields: unknown[], overrides: Partial<FormSaveInput> = {}): FormSaveInput {
  return formSaveSchema.parse({
    title: "검증 설문",
    description: null,
    subjectName: null,
    requiresLogin: true,
    allowMultipleResponses: false,
    allowEditAfterSubmit: false,
    shuffleFields: false,
    showProgressBar: true,
    confirmationMessage: null,
    closedMessage: null,
    openAt: null,
    closeAt: null,
    maxResponses: null,
    fields,
    ...overrides,
  });
}

async function main() {
  const owner = await prisma.user.findFirst({ where: { status: "ACTIVE" }, select: { id: true } });
  if (!owner) throw new Error("검증에 사용할 활성 사용자가 없습니다.");

  const title = `설문 저장 검증 ${randomUUID().slice(0, 8)}`;
  const activityId = await createFormActivity(prisma, owner.id, title);
  const form = await prisma.form.create({
    data: { ownerId: owner.id, activityId, slug: `verify-save-${randomUUID()}`, title },
    select: { id: true },
  });

  try {
    await checkCreatesFields(form.id);
    await checkOptionIdsSurvive(form.id);
    await checkTypeChangeClearsColumns(form.id);
    await checkRejectsUnknownIds(form.id);
    await checkDestructiveNeedsConfirm(form.id);
    await checkOpenFormRemainsEditable(form.id);
    await checkOptimisticConcurrency(form.id);
    await checkActivityTitleFollows(form.id, activityId);

    console.log("forms_save_checks=passed");
  } finally {
    await deleteFormFixture(prisma, form.id, activityId).catch(() => undefined);
    await prisma.$disconnect();
  }
}

/** 새 질문은 위치 순서대로 만들어져야 합니다. */
async function checkCreatesFields(formId: string) {
  await saveFormDocument(formId, saveInput([
    { type: "SHORT_TEXT", title: "이름", description: null, required: true, validation: null },
    {
      type: "MULTIPLE_CHOICE", title: "학년", description: null, required: false,
      options: [{ text: "1학년" }, { text: "2학년" }, { text: "3학년" }],
      shuffleOptions: false, allowOther: false,
    },
  ]));

  const fields = await prisma.formField.findMany({ where: { formId }, orderBy: { position: "asc" }, include: { options: true } });
  assert.equal(fields.length, 2, "질문 2개가 만들어져야 합니다.");
  assert.deepEqual(fields.map((field) => field.position), [0, 1], "position이 배열 순서와 같아야 합니다.");
  assert.equal(fields[0].required, true, "필수 여부가 저장되지 않았습니다.");
  assert.equal(fields[1].options.length, 3, "보기 3개가 만들어져야 합니다.");
}

/**
 * 보기 텍스트·순서를 바꿔도 **ID는 그대로**여야 합니다. ID가 바뀌면 그 보기를 고른 과거 응답의
 * `selectedOptionIds`가 아무것도 가리키지 않게 되어 집계가 0이 됩니다.
 */
async function checkOptionIdsSurvive(formId: string) {
  const before = await prisma.formField.findFirstOrThrow({
    where: { formId, type: "MULTIPLE_CHOICE" },
    include: { options: { orderBy: { position: "asc" } } },
  });
  const beforeIds = before.options.map((option) => option.id);

  const shortText = await prisma.formField.findFirstOrThrow({ where: { formId, type: "SHORT_TEXT" }, select: { id: true } });
  await saveFormDocument(formId, saveInput([
    { id: shortText.id, type: "SHORT_TEXT", title: "이름", description: null, required: true, validation: null },
    {
      id: before.id, type: "MULTIPLE_CHOICE", title: "학년", description: null, required: false,
      // 순서를 뒤집고 첫 보기의 문구를 고칩니다. 새 보기도 하나 더합니다.
      options: [
        { id: beforeIds[2], text: "3학년" },
        { id: beforeIds[1], text: "2학년" },
        { id: beforeIds[0], text: "1학년(수정)" },
        { text: "선택 안 함" },
      ],
      shuffleOptions: true, allowOther: false,
    },
  ]));

  const after = await prisma.formField.findUniqueOrThrow({
    where: { id: before.id },
    include: { options: { orderBy: { position: "asc" } } },
  });
  assert.deepEqual(
    after.options.slice(0, 3).map((option) => option.id),
    [beforeIds[2], beforeIds[1], beforeIds[0]],
    "보기 ID가 순서만 바뀐 채 보존되어야 합니다.",
  );
  assert.equal(after.options[2].text, "1학년(수정)", "보기 문구가 갱신되지 않았습니다.");
  assert.equal(after.options.length, 4, "새 보기가 추가되지 않았습니다.");
  assert.equal(after.shuffleOptions, true, "보기 섞기 설정이 저장되지 않았습니다.");
}

/** 유형을 바꾸면 이전 유형의 열이 **명시적으로** 비워져야 합니다. */
async function checkTypeChangeClearsColumns(formId: string) {
  const scale = await saveThenFind(formId, [
    {
      type: "LINEAR_SCALE", title: "만족도", description: null, required: false,
      scaleMin: 1, scaleMax: 7, scaleMinLabel: "불만", scaleMaxLabel: "만족",
    },
  ], "LINEAR_SCALE");
  assert.equal(scale.scaleMax, 7, "척도 끝 값이 저장되지 않았습니다.");

  const asText = await saveThenFind(formId, [
    { id: scale.id, type: "SHORT_TEXT", title: "만족도", description: null, required: false, validation: null },
  ], "SHORT_TEXT");
  assert.equal(asText.id, scale.id, "유형만 바뀌고 질문 ID는 유지되어야 합니다.");
  assert.equal(asText.scaleMin, null, "이전 유형의 scaleMin이 남았습니다.");
  assert.equal(asText.scaleMax, null, "이전 유형의 scaleMax가 남았습니다.");
  assert.equal(asText.scaleMinLabel, null, "이전 유형의 라벨이 남았습니다.");

  // 보기를 가지던 유형에서 안 가지는 유형으로 가면 보기 행도 사라져야 합니다.
  const withOptions = await saveThenFind(formId, [
    {
      type: "CHECKBOXES", title: "관심사", description: null, required: false,
      options: [{ text: "가" }, { text: "나" }], shuffleOptions: false, allowOther: false, validation: null,
    },
  ], "CHECKBOXES");
  const cleared = await saveThenFind(formId, [
    { id: withOptions.id, type: "LONG_TEXT", title: "관심사", description: null, required: false, validation: null },
  ], "LONG_TEXT");
  const leftover = await prisma.formFieldOption.count({ where: { fieldId: cleared.id } });
  assert.equal(leftover, 0, "보기를 안 쓰는 유형으로 바꿨는데 보기 행이 남았습니다.");
}

/** 편집기가 낡았을 때(없는 ID를 보낼 때) 부분 적용이 아니라 저장 전체가 거부돼야 합니다. */
async function checkRejectsUnknownIds(formId: string) {
  const before = await prisma.formField.count({ where: { formId } });
  await assert.rejects(
    () => saveFormDocument(formId, saveInput([
      { id: `missing-${randomUUID()}`, type: "SHORT_TEXT", title: "유령", description: null, required: false, validation: null },
    ])),
    /일치하지 않습니다/,
    "현재 설문에 없는 질문 ID가 통과했습니다.",
  );
  assert.equal(await prisma.formField.count({ where: { formId } }), before, "거부된 저장이 일부라도 반영됐습니다.");
}

/** 응답이 달린 질문 삭제는 명시적 확인 없이는 거부돼야 합니다. */
async function checkDestructiveNeedsConfirm(formId: string) {
  const keep = await saveThenFind(formId, [
    { type: "SHORT_TEXT", title: "남길 질문", description: null, required: false, validation: null },
    { type: "SHORT_TEXT", title: "지울 질문", description: null, required: false, validation: null },
  ], "SHORT_TEXT");
  const fields = await prisma.formField.findMany({ where: { formId }, orderBy: { position: "asc" }, select: { id: true, title: true } });
  const doomed = fields.find((field) => field.title === "지울 질문")!;
  const survivor = fields.find((field) => field.title === "남길 질문")!;

  const response = await prisma.formResponse.create({
    data: { formId, dedupeKey: `u:${randomUUID()}`, submittedAt: new Date() },
    select: { id: true },
  });
  await prisma.formAnswer.create({
    data: { responseId: response.id, fieldId: doomed.id, fieldType: "SHORT_TEXT", fieldTitle: doomed.title, textValue: "응답" },
  });

  const withoutDoomed = [
    { id: survivor.id, type: "SHORT_TEXT" as const, title: "남길 질문", description: null, required: false, validation: null },
  ];
  // 이미 응답을 받는 중이어도 편집은 가능하지만, 기존 답변 삭제 확인은 생략할 수 없습니다.
  await prisma.form.update({ where: { id: formId }, data: { status: "OPEN" } });
  try {
    await assert.rejects(
      () => saveFormDocument(formId, saveInput(withoutDoomed)),
      (error: unknown) => error instanceof DestructiveSaveError && error.answerCount === 1,
      "OPEN 설문의 응답이 달린 질문이 확인 없이 지워졌습니다.",
    );
    assert.ok(await prisma.formField.findUnique({ where: { id: doomed.id } }), "거부됐는데 질문이 지워졌습니다.");

    // 확인을 붙이면 OPEN 상태를 유지한 채 질문과 그 답변이 함께 지워집니다.
    await saveFormDocument(formId, saveInput(withoutDoomed, { confirmDestructive: true }));
    assert.equal(await prisma.formField.count({ where: { id: doomed.id } }), 0, "확인 후에도 질문이 남았습니다.");
    assert.equal(await prisma.formAnswer.count({ where: { fieldId: doomed.id } }), 0, "질문의 응답이 함께 지워지지 않았습니다.");
    assert.equal((await prisma.form.findUniqueOrThrow({ where: { id: formId }, select: { status: true } })).status, "OPEN");
  } finally {
    await prisma.form.update({ where: { id: formId }, data: { status: "DRAFT" } });
  }
  assert.ok(keep, "픽스처 준비 실패");
}

/** 응답을 받는 중(OPEN)에도 질문 추가·유형 변경·삭제가 가능해야 합니다. */
async function checkOpenFormRemainsEditable(formId: string) {
  await saveThenFind(formId, [
    { type: "SHORT_TEXT", title: "열린 설문 질문", description: null, required: false, validation: null },
    { type: "SHORT_TEXT", title: "지울 질문", description: null, required: false, validation: null },
  ], "SHORT_TEXT");
  const fields = await prisma.formField.findMany({ where: { formId }, orderBy: { position: "asc" }, select: { id: true } });
  await prisma.form.update({ where: { id: formId }, data: { status: "OPEN" } });

  try {
    await saveFormDocument(formId, saveInput([
      { id: fields[0].id, type: "LONG_TEXT", title: "유형을 바꾼 질문", description: null, required: false, validation: null },
      {
        type: "MULTIPLE_CHOICE", title: "새로 추가한 질문", description: null, required: false,
        options: [{ text: "예" }, { text: "아니요" }], shuffleOptions: false, allowOther: false,
      },
    ]));

    const after = await prisma.formField.findMany({
      where: { formId },
      orderBy: { position: "asc" },
      select: { id: true, type: true, title: true },
    });
    assert.equal(after.length, 2, "OPEN 설문에서 질문 삭제·추가가 반영되지 않았습니다.");
    assert.equal(after[0].id, fields[0].id, "유형 변경 중 기존 질문 ID가 바뀌었습니다.");
    assert.equal(after[0].type, "LONG_TEXT", "OPEN 설문에서 질문 유형 변경이 막혔습니다.");
    assert.equal(after[1].title, "새로 추가한 질문", "OPEN 설문에 새 질문이 추가되지 않았습니다.");
    assert.equal(await prisma.formField.count({ where: { id: fields[1].id } }), 0, "OPEN 설문에서 질문이 삭제되지 않았습니다.");
  } finally {
    await prisma.form.update({ where: { id: formId }, data: { status: "DRAFT" } });
  }
}

/**
 * 저장하는 사이에 다른 곳(다른 탭, 공유받은 EDITOR)이 먼저 저장했으면 거부해야 합니다.
 *
 * `useDocumentSave`의 `isCurrent()`는 같은 탭 안의 편집만 보호합니다. 이 검사는 그 바깥 —
 * 서버가 저장 직전 실제 `updatedAt`과 편집기가 불러온 시점의 값을 비교하는 낙관적 동시성
 * 잠금이 실제로 걸리는지를 봅니다.
 */
async function checkOptimisticConcurrency(formId: string) {
  const field = await saveThenFind(formId, [
    { type: "SHORT_TEXT", title: "동시성 검증 질문", description: null, required: false, validation: null },
  ], "SHORT_TEXT");
  const loaded = await prisma.form.findUniqueOrThrow({ where: { id: formId }, select: { updatedAt: true } });

  await assert.rejects(
    () => saveFormDocument(formId, saveInput(
      [{ id: field.id, type: "SHORT_TEXT" as const, title: "낡은 값으로 저장 시도", description: null, required: false, validation: null }],
      { expectedUpdatedAt: new Date(loaded.updatedAt.getTime() - 60_000).toISOString() },
    )),
    (error: unknown) => error instanceof ConflictSaveError,
    "낡은 updatedAt으로 보낸 저장이 거부되지 않았습니다.",
  );

  // 맞는 값을 보내면 정상적으로 저장됩니다.
  await saveFormDocument(formId, saveInput(
    [{ id: field.id, type: "SHORT_TEXT" as const, title: "맞는 값으로 저장", description: null, required: false, validation: null }],
    { expectedUpdatedAt: loaded.updatedAt.toISOString() },
  ));
  const after = await prisma.formField.findUniqueOrThrow({ where: { id: field.id }, select: { title: true } });
  assert.equal(after.title, "맞는 값으로 저장", "expectedUpdatedAt이 맞는데도 저장이 거부됐습니다.");

  const concurrentVersion = await prisma.form.findUniqueOrThrow({ where: { id: formId }, select: { updatedAt: true } });
  const concurrent = await Promise.allSettled(["동시 저장 A", "동시 저장 B"].map((title) =>
    saveFormDocument(formId, saveInput(
      [{ id: field.id, type: "SHORT_TEXT" as const, title, description: null, required: false, validation: null }],
      { expectedUpdatedAt: concurrentVersion.updatedAt.toISOString() },
    )),
  ));
  assert.equal(concurrent.filter((result) => result.status === "fulfilled").length, 1, "같은 버전에서 시작한 동시 저장이 둘 다 성공했습니다.");
  assert.equal(
    concurrent.filter((result) => result.status === "rejected" && result.reason instanceof ConflictSaveError).length,
    1,
    "동시 저장에서 뒤늦은 요청이 ConflictSaveError로 거부되지 않았습니다.",
  );

  // expectedUpdatedAt을 아예 안 보내면(검증 스크립트가 매번 채우지 않아도 되도록) 검사를 건너뜁니다.
  await saveFormDocument(formId, saveInput(
    [{ id: field.id, type: "SHORT_TEXT" as const, title: "검사 생략", description: null, required: false, validation: null }],
  ));
  const skipped = await prisma.formField.findUniqueOrThrow({ where: { id: field.id }, select: { title: true } });
  assert.equal(skipped.title, "검사 생략", "expectedUpdatedAt 없이 보낸 저장이 막혔습니다.");
}

/** 제목을 바꾸면 /report가 읽는 활동 레코드도 따라가야 합니다. */
async function checkActivityTitleFollows(formId: string, activityId: string) {
  const fields = await prisma.formField.findMany({ where: { formId }, orderBy: { position: "asc" }, select: { id: true } });
  await saveFormDocument(formId, saveInput(
    fields.map((row) => ({ id: row.id, type: "SHORT_TEXT" as const, title: "그대로", description: null, required: false, validation: null })),
    { title: "제목을 바꿨습니다" },
  ));
  const activity = await prisma.activity.findUniqueOrThrow({ where: { id: activityId }, select: { title: true } });
  assert.equal(activity.title, "제목을 바꿨습니다", "설문 제목이 활동 레코드에 반영되지 않았습니다.");
}

/** 저장한 뒤 그 유형의 질문 하나를 돌려줍니다. 여러 검사에서 같은 준비 과정을 씁니다. */
async function saveThenFind(formId: string, fields: unknown[], type: string) {
  await saveFormDocument(formId, saveInput(fields));
  return prisma.formField.findFirstOrThrow({ where: { formId, type: type as never }, orderBy: { position: "asc" } });
}

void main().catch(async (error) => {
  console.error(error);
  await prisma.$disconnect();
  process.exit(1);
});
