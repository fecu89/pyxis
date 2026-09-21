import "../lib/load-env";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { createFormActivity, deleteFormFixture } from "./fixtures";
import { getPrisma } from "../lib/prisma";
import { AnswerValidationError, submitFormResponse, updateFormResponse } from "../lib/forms/submit";
import { sendDueFormResponseDigests } from "../lib/forms/response-digest";

const prisma = getPrisma();
const fixtures: Array<{ formId: string; activityId: string }> = [];

async function createForm(ownerId: string, data: Record<string, unknown> = {}) {
  const title = `후속 기능 검증 ${randomUUID().slice(0, 8)}`;
  const activityId = await createFormActivity(prisma, ownerId, title);
  const form = await prisma.form.create({
    data: { ownerId, activityId, slug: `verify-followup-${randomUUID()}`, title, status: "OPEN", requiresLogin: false, ...data },
  });
  fixtures.push({ formId: form.id, activityId });
  return form;
}

async function main() {
  const users = await prisma.user.findMany({ where: { status: "ACTIVE" }, select: { id: true }, take: 2 });
  if (users.length < 2) throw new Error("검증에 사용할 활성 사용자 두 명이 필요합니다.");
  try {
    await checkBranching(users[0].id);
    await checkMultipleResponseEdit(users[0].id);
    await checkFileOwnership(users[0].id, users[1].id);
    await checkDailyDigest(users[0].id);
    console.log("forms_followup_checks=passed branching=1 files=1 digest=1 multiple_edit=1");
  } finally {
    for (const fixture of fixtures) await deleteFormFixture(prisma, fixture.formId, fixture.activityId).catch(() => undefined);
    await prisma.$disconnect();
  }
}

async function checkBranching(ownerId: string) {
  const form = await createForm(ownerId);
  const choice = await prisma.formField.create({ data: { formId: form.id, type: "MULTIPLE_CHOICE", title: "계속할까요?", position: 0, required: true } });
  const option = await prisma.formFieldOption.create({ data: { fieldId: choice.id, text: "여기서 제출", position: 0 } });
  const section = await prisma.formField.create({ data: { formId: form.id, type: "SECTION_HEADER", title: "추가 질문", position: 1 } });
  const required = await prisma.formField.create({ data: { formId: form.id, type: "SHORT_TEXT", title: "필수", position: 2, required: true } });
  await prisma.formField.update({ where: { id: choice.id }, data: { branchRules: [{ optionId: option.id, destination: "SUBMIT" }] } });
  const saved = await submitFormResponse(form.id, { guestTokenHash: randomUUID() }, { answers: { [choice.id]: { selectedOptionIds: [option.id] } } });
  assert.ok(saved.id, "제출 분기가 뒤 섹션의 필수 질문을 정상적으로 건너뛰어야 합니다.");
  await prisma.formField.update({ where: { id: choice.id }, data: { branchRules: [{ optionId: option.id, destination: section.id }] } });
  await assert.rejects(
    () => submitFormResponse(form.id, { guestTokenHash: randomUUID() }, { answers: { [choice.id]: { selectedOptionIds: [option.id] } } }),
    (error) => error instanceof AnswerValidationError && error.fieldId === required.id,
  );
}

async function checkMultipleResponseEdit(ownerId: string) {
  const form = await createForm(ownerId, { allowMultipleResponses: true, allowEditAfterSubmit: true });
  const field = await prisma.formField.create({ data: { formId: form.id, type: "SHORT_TEXT", title: "답", position: 0, required: true } });
  const identity = { guestTokenHash: randomUUID() };
  const first = await submitFormResponse(form.id, identity, { answers: { [field.id]: { textValue: "첫 응답" } } });
  const second = await submitFormResponse(form.id, identity, { answers: { [field.id]: { textValue: "둘째 응답" } } });
  await updateFormResponse(form.id, first.id, { answers: { [field.id]: { textValue: "첫 응답 수정" } } });
  const rows = await prisma.formAnswer.findMany({ where: { responseId: { in: [first.id, second.id] } }, select: { responseId: true, textValue: true } });
  assert.equal(rows.find((row) => row.responseId === first.id)?.textValue, "첫 응답 수정");
  assert.equal(rows.find((row) => row.responseId === second.id)?.textValue, "둘째 응답");
}

async function checkFileOwnership(ownerId: string, otherUserId: string) {
  const form = await createForm(ownerId, { requiresLogin: true });
  const field = await prisma.formField.create({ data: { formId: form.id, type: "FILE_UPLOAD", title: "파일", position: 0, required: true } });
  const file = await prisma.formUploadedFile.create({
    data: {
      formId: form.id, fieldId: field.id, uploaderId: ownerId, type: "PDF", originalName: "answer.pdf",
      storedName: `${randomUUID()}.pdf`, storagePath: `verify/${randomUUID()}.pdf`, mimeType: "application/pdf", fileSize: 100,
    },
  });
  await assert.rejects(
    () => submitFormResponse(form.id, { respondentId: otherUserId }, { answers: { [field.id]: { fileIds: [file.id] } } }),
    (error) => error instanceof AnswerValidationError,
  );
  const response = await submitFormResponse(form.id, { respondentId: ownerId }, { answers: { [field.id]: { fileIds: [file.id] } } });
  const attached = await prisma.formUploadedFile.findUniqueOrThrow({ where: { id: file.id } });
  assert.equal(attached.responseId, response.id);
  assert.ok(attached.answerId);
}

async function checkDailyDigest(ownerId: string) {
  const form = await createForm(ownerId, {
    responseDigestPendingCount: 3,
    responseDigestPendingSince: new Date(Date.now() - 25 * 60 * 60 * 1000),
  });
  assert.equal(await sendDueFormResponseDigests(new Date(), 24 * 60 * 60 * 1000), 1);
  assert.equal(await sendDueFormResponseDigests(new Date(), 24 * 60 * 60 * 1000), 0);
  const notification = await prisma.notification.findFirst({ where: { formId: form.id, type: "FORM_RESPONSE_DIGEST" } });
  assert.equal(notification?.responseCount, 3);
  const updated = await prisma.form.findUniqueOrThrow({ where: { id: form.id } });
  assert.equal(updated.responseDigestPendingCount, 0);
  assert.equal(updated.responseDigestPendingSince, null);
}

main().catch((error) => { console.error(error); process.exitCode = 1; });
