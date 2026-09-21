import "../lib/load-env";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { unlink } from "node:fs/promises";
import { parse as parseCookies } from "cookie";
import { encode } from "next-auth/jwt";
import { createFormActivity, deleteFormFixture } from "./fixtures";
import { getPrisma } from "../lib/prisma";
import { resolveStoredFile } from "../lib/files/paths";

// 공개 제출 API를 실제 HTTP로 검증합니다(`verify-export-rate-limits.ts`와 같은 방식).
//
//   NODE_OPTIONS=--conditions=react-server yarn verify:forms-submit
//
// 여기서 증명하려는 것은 lib/forms/submit.ts의 설계가 실제 요청·응답 경로에서도 지켜지는가
// 입니다 — 특히 정원 동시 제출은 순차 호출로는 재현되지 않아서 반드시 Promise.all로
// 동시에 쏴야 의미가 있습니다.

const baseUrl = process.env.VERIFY_BASE_URL || "http://localhost:3001";
// 프로덕션 서버를 loopback으로 검증할 때 요청 주소와 허용 Origin이 다릅니다. 외부 Cloudflare
// 주소로 테스트 트래픽을 되돌리면 CF-Connecting-IP 검증과 충돌하므로 둘을 따로 지정합니다.
const requestOrigin = process.env.VERIFY_ORIGIN || baseUrl;
const prisma = getPrisma();

type Fixture = { formId: string; activityId: string; slug: string };
const fixtures: Fixture[] = [];
const uploadedStoragePaths: string[] = [];

async function createForm(owner: string, overrides: Record<string, unknown> = {}) {
  const title = `제출 검증 ${randomUUID().slice(0, 8)}`;
  const activityId = await createFormActivity(prisma, owner, title);
  const form = await prisma.form.create({
    data: {
      ownerId: owner,
      activityId,
      slug: `verify-submit-${randomUUID()}`,
      title,
      status: "OPEN",
      requiresLogin: false,
      ...overrides,
    },
    select: { id: true, slug: true },
  });
  fixtures.push({ formId: form.id, activityId, slug: form.slug });
  return { ...form, clientIp: `203.0.113.${fixtures.length}` };
}

function jsonHeaders(form: { clientIp: string }, extra: Record<string, string> = {}) {
  return {
    "Content-Type": "application/json",
    Origin: requestOrigin,
    "CF-Connecting-IP": form.clientIp,
    "X-Forwarded-For": form.clientIp,
    ...extra,
  };
}

async function addShortText(formId: string, required = true) {
  return prisma.formField.create({ data: { formId, type: "SHORT_TEXT", title: "이름", position: 0, required } });
}

async function addChoice(formId: string, position = 1) {
  const field = await prisma.formField.create({
    data: { formId, type: "MULTIPLE_CHOICE", title: "학년", position, required: false },
  });
  const options = await Promise.all([
    prisma.formFieldOption.create({ data: { fieldId: field.id, text: "1학년", position: 0 } }),
    prisma.formFieldOption.create({ data: { fieldId: field.id, text: "2학년", position: 1 } }),
  ]);
  return { field, options };
}

function extractGuestCookie(response: Response): string | null {
  const setCookie = response.headers.get("set-cookie");
  if (!setCookie) return null;
  const parsed = parseCookies(setCookie.split(",")[0] ?? "");
  const [name, value] = Object.entries(parsed).find(([key]) => key.startsWith("form_guest_")) ?? [];
  return name && value ? `${name}=${value}` : null;
}

async function main() {
  const owner = await prisma.user.findFirst({ where: { status: "ACTIVE", role: { in: ["TEACHER", "ADMIN", "SUPER_ADMIN"] } }, select: { id: true } });
  if (!owner) throw new Error("검증에 사용할 활성 교사·관리자 계정이 없습니다.");
  const respondent = await prisma.user.findFirst({ where: { status: "ACTIVE" }, select: { id: true, authVersion: true } });
  if (!respondent) throw new Error("검증에 사용할 활성 사용자가 없습니다.");

  try {
    await checkAnonymousSubmitAndDedupe(owner.id);
    await checkServerSideValidation(owner.id);
    await checkCapacityRace(owner.id);
    await checkClosedForm(owner.id);
    await checkEditAfterSubmit(owner.id);
    await checkYearlessDate(owner.id);
    await checkPayloadLimit(owner.id);
    await checkLoginRequired(owner.id, respondent.id, respondent.authVersion);
    await checkFileUpload(owner.id, respondent.id, respondent.authVersion);
    await checkGridSubmit(owner.id);
    await checkSignatureSubmit(owner.id);
    await checkRateLimit(owner.id);

    console.log("forms_submit_checks=passed");
  } finally {
    for (const fixture of fixtures) {
      await deleteFormFixture(prisma, fixture.formId, fixture.activityId).catch(() => undefined);
    }
    for (const storagePath of uploadedStoragePaths) await unlink(resolveStoredFile(storagePath)).catch(() => undefined);
    await prisma.$disconnect();
  }
}

/** 익명 제출은 게스트 쿠키를 발급하고, 같은 쿠키로 다시 내면 1인 1응답이 막아야 합니다. */
async function checkAnonymousSubmitAndDedupe(owner: string) {
  const form = await createForm(owner, { shuffleFields: true });
  const field = await addShortText(form.id);
  const { field: choiceField, options } = await addChoice(form.id);
  await prisma.formField.update({ where: { id: choiceField.id }, data: { shuffleOptions: true } });
  const beforeSubmit = await prisma.form.findUniqueOrThrow({ where: { id: form.id }, select: { updatedAt: true } });

  const defResponse = await fetch(`${baseUrl}/api/public/forms/${form.slug}`);
  const def = await defResponse.json();
  assert.equal(defResponse.status, 200, "공개 설문 정의를 불러오지 못했습니다.");
  assert.equal(def.form.fields.length, 2, "필드 개수가 다릅니다.");
  assert.equal(def.form.shuffleFields, true, "공개 정의에서 질문 섞기 설정이 누락됐습니다.");
  assert.equal(def.form.fields.find((item: { id: string }) => item.id === choiceField.id)?.shuffleOptions, true, "보기 섞기 설정이 누락됐습니다.");
  assert.equal(def.closedReason, null, "OPEN 설문인데 마감 사유가 붙었습니다.");

  const submit = await fetch(`${baseUrl}/api/public/forms/${form.slug}/responses`, {
    method: "POST",
    headers: jsonHeaders(form),
    body: JSON.stringify({ answers: { [field.id]: { textValue: "홍길동" }, [choiceField.id]: { selectedOptionIds: [options[0].id] } } }),
  });
  assert.equal(submit.status, 201, "정상 익명 제출이 거부됐습니다.");
  const guestCookie = extractGuestCookie(submit);
  assert.ok(guestCookie, "익명 제출에 게스트 쿠키가 발급되지 않았습니다.");

  const saved = await submit.json();
  const answer = await prisma.formAnswer.findFirst({ where: { responseId: saved.response.id, fieldId: choiceField.id } });
  assert.equal(answer?.fieldType, "MULTIPLE_CHOICE", "응답 시점 fieldType 스냅샷이 저장되지 않았습니다.");
  assert.deepEqual(answer?.selectedOptionTexts, ["1학년"], "보기 텍스트 스냅샷이 서버에서 채워지지 않았습니다.");
  const afterSubmit = await prisma.form.findUniqueOrThrow({ where: { id: form.id }, select: { updatedAt: true } });
  assert.equal(afterSubmit.updatedAt.toISOString(), beforeSubmit.updatedAt.toISOString(), "응답 수 증가가 편집 문서 updatedAt을 바꿨습니다.");

  const retry = await fetch(`${baseUrl}/api/public/forms/${form.slug}/responses`, {
    method: "POST",
    headers: jsonHeaders(form, { Cookie: guestCookie! }),
    body: JSON.stringify({ answers: { [field.id]: { textValue: "다시 제출" } } }),
  });
  if (retry.status !== 409) console.error("DEBUG retry body:", await retry.clone().json().catch(() => retry.text()));
  assert.equal(retry.status, 409, "같은 게스트 쿠키의 재제출이 거부되지 않았습니다.");

  const anotherGuest = await fetch(`${baseUrl}/api/public/forms/${form.slug}/responses`, {
    method: "POST",
    headers: jsonHeaders(form),
    body: JSON.stringify({ answers: { [field.id]: { textValue: "다른 사람" } } }),
  });
  assert.equal(anotherGuest.status, 201, "쿠키가 다른(다른 사람) 제출이 거부됐습니다.");

  assert.equal(await prisma.formResponse.count({ where: { formId: form.id } }), 2, "응답이 정확히 2건 남아야 합니다.");
}

/** 화면을 거치지 않고 보낸 요청도 서버가 다시 검사해야 합니다 — 존재하지 않는 보기 ID, 빈 필수값. */
async function checkServerSideValidation(owner: string) {
  const form = await createForm(owner);
  const required = await addShortText(form.id, true);
  const { field: choiceField } = await addChoice(form.id);

  const emptyRequired = await fetch(`${baseUrl}/api/public/forms/${form.slug}/responses`, {
    method: "POST",
    headers: jsonHeaders(form),
    body: JSON.stringify({ answers: {} }),
  });
  assert.equal(emptyRequired.status, 400, "필수 항목이 빈 제출이 통과했습니다.");
  const emptyBody = await emptyRequired.json();
  assert.equal(emptyBody.fieldId, required.id, "어느 필드가 문제인지 알려주지 않습니다.");

  const ghostOption = await fetch(`${baseUrl}/api/public/forms/${form.slug}/responses`, {
    method: "POST",
    headers: jsonHeaders(form),
    body: JSON.stringify({ answers: { [required.id]: { textValue: "이름" }, [choiceField.id]: { selectedOptionIds: ["ghost-option-id"] } } }),
  });
  assert.equal(ghostOption.status, 400, "존재하지 않는 보기 ID를 담은 제출이 서버에서 통과했습니다.");

  const ghostField = await fetch(`${baseUrl}/api/public/forms/${form.slug}/responses`, {
    method: "POST",
    headers: jsonHeaders(form),
    body: JSON.stringify({ answers: { [required.id]: { textValue: "이름" }, "ghost-field": { textValue: "숨은 값" } } }),
  });
  assert.equal(ghostField.status, 400, "현재 설문에 없는 질문 ID가 무시된 채 제출됐습니다.");

  assert.equal(await prisma.formResponse.count({ where: { formId: form.id } }), 0, "거부된 제출이 DB에 남았습니다.");
}

/**
 * 정원 동시 제출. 마지막 한 자리를 두고 요청 두 개를 **동시에** 보냅니다 — 순차 호출로는
 * 이 레이스가 재현되지 않습니다.
 */
async function checkCapacityRace(owner: string) {
  const form = await createForm(owner, { maxResponses: 1 });
  const field = await addShortText(form.id, false);

  const [first, second] = await Promise.all([
    fetch(`${baseUrl}/api/public/forms/${form.slug}/responses`, {
      method: "POST", headers: jsonHeaders(form),
      body: JSON.stringify({ answers: { [field.id]: { textValue: "A" } } }),
    }),
    fetch(`${baseUrl}/api/public/forms/${form.slug}/responses`, {
      method: "POST", headers: jsonHeaders(form),
      body: JSON.stringify({ answers: { [field.id]: { textValue: "B" } } }),
    }),
  ]);
  const statuses = [first.status, second.status].sort();
  assert.deepEqual(statuses, [201, 409], "정원 1명 설문에 동시 요청 두 건 중 정확히 하나만 통과해야 합니다.");

  assert.equal(await prisma.formResponse.count({ where: { formId: form.id } }), 1, "정원을 넘는 응답이 저장됐습니다.");
  const finalForm = await prisma.form.findUniqueOrThrow({ where: { id: form.id }, select: { responseCount: true } });
  assert.equal(finalForm.responseCount, 1, "responseCount가 실제 응답 수와 어긋납니다.");
}

/** 마감된 설문은 정의를 숨기고, 제출도 거부해야 합니다. */
async function checkClosedForm(owner: string) {
  const closedMessage = "신청이 끝났습니다. 담당 교사에게 문의해 주세요.";
  const form = await createForm(owner, { status: "CLOSED", closedMessage });
  await addShortText(form.id, false);

  const def = await (await fetch(`${baseUrl}/api/public/forms/${form.slug}`)).json();
  assert.equal(def.closedReason, "CLOSED", "마감된 설문의 closedReason이 비어 있습니다.");
  assert.equal(def.closedMessage, closedMessage, "마감 안내 문구가 공개 응답 화면에 전달되지 않았습니다.");
  assert.equal(def.form.fields, undefined, "마감된 설문인데 질문 내용을 그대로 보냈습니다.");

  const submit = await fetch(`${baseUrl}/api/public/forms/${form.slug}/responses`, {
    method: "POST", headers: jsonHeaders(form), body: JSON.stringify({ answers: {} }),
  });
  assert.equal(submit.status, 409, "마감된 설문에 제출이 거부되지 않았습니다.");
  assert.equal((await submit.json()).error, closedMessage, "제출 직전 마감된 경우 사용자 지정 안내가 보이지 않습니다.");
}

/** allowEditAfterSubmit이면 PATCH로 고칠 수 있고, allowMultipleResponses면 이 경로를 정직하게 거부해야 합니다. */
async function checkEditAfterSubmit(owner: string) {
  const editable = await createForm(owner, { allowEditAfterSubmit: true });
  const field = await addShortText(editable.id, false);
  await prisma.formField.update({
    where: { id: field.id },
    data: { validation: { kind: "length", op: "max", value: 100 } },
  });

  const submitRes = await fetch(`${baseUrl}/api/public/forms/${editable.slug}/responses`, {
    method: "POST", headers: jsonHeaders(editable),
    body: JSON.stringify({ answers: { [field.id]: { textValue: "처음 값" } } }),
  });
  const guestCookie = extractGuestCookie(submitRes)!;

  const patchRes = await fetch(`${baseUrl}/api/public/forms/${editable.slug}/responses`, {
    method: "PATCH", headers: jsonHeaders(editable, { Cookie: guestCookie }),
    body: JSON.stringify({ answers: { [field.id]: { textValue: "고친 값" } } }),
  });
  assert.equal(patchRes.status, 200, "제출 후 수정이 거부됐습니다.");

  const { response } = await patchRes.json();
  const stored = await prisma.formAnswer.findFirst({ where: { responseId: response.id, fieldId: field.id } });
  assert.equal(stored?.textValue, "고친 값", "PATCH가 실제 값을 갱신하지 않았습니다.");
  assert.equal(await prisma.formResponse.count({ where: { formId: editable.id } }), 1, "PATCH가 새 응답을 만들었습니다 — 기존 응답을 고쳐야 합니다.");

  const editDefinition = await fetch(`${baseUrl}/api/public/forms/${editable.slug}`, { headers: { Cookie: guestCookie, "CF-Connecting-IP": editable.clientIp } });
  const editData = await editDefinition.json();
  assert.equal(editData.canEdit, true, "수정 가능한 응답인데 canEdit가 내려오지 않았습니다.");
  assert.equal(editData.existingAnswers?.[field.id]?.textValue, "고친 값", "수정 화면에 기존 답변이 복원되지 않았습니다.");
  assert.deepEqual(
    editData.form.fields.find((item: { id: string }) => item.id === field.id)?.validation,
    { kind: "length", op: "max", value: 100 },
    "응답 화면에 서버와 같은 응답 확인 규칙이 전달되지 않았습니다.",
  );

  const multi = await createForm(owner, { allowEditAfterSubmit: true, allowMultipleResponses: true });
  const multiField = await addShortText(multi.id, false);
  const multiPatch = await fetch(`${baseUrl}/api/public/forms/${multi.slug}/responses`, {
    method: "PATCH", headers: jsonHeaders(multi),
    body: JSON.stringify({ answers: { [multiField.id]: { textValue: "x" } } }),
  });
  assert.equal(multiPatch.status, 409, "복수 응답 설문의 PATCH가 거부되지 않았습니다 — 어느 응답을 고칠지 정할 수 없는데 통과했습니다.");

  const firstSubmit = await fetch(`${baseUrl}/api/public/forms/${multi.slug}/responses`, {
    method: "POST", headers: jsonHeaders(multi), body: JSON.stringify({ answers: { [multiField.id]: { textValue: "첫 응답" } } }),
  });
  const multiGuestCookie = extractGuestCookie(firstSubmit)!;
  const first = (await firstSubmit.json()).response;
  const secondSubmit = await fetch(`${baseUrl}/api/public/forms/${multi.slug}/responses`, {
    method: "POST", headers: jsonHeaders(multi, { Cookie: multiGuestCookie }), body: JSON.stringify({ answers: { [multiField.id]: { textValue: "둘째 응답" } } }),
  });
  const second = (await secondSubmit.json()).response;
  const unauthorized = await fetch(`${baseUrl}/api/public/forms/${multi.slug}/responses/${first.id}`);
  assert.equal(unauthorized.status, 404, "응답 ID만 아는 요청이 복수 응답 수정 데이터를 읽었습니다.");
  const owned = await fetch(`${baseUrl}/api/public/forms/${multi.slug}/responses/${first.id}`, { headers: { Cookie: multiGuestCookie, "CF-Connecting-IP": multi.clientIp } });
  assert.equal(owned.status, 200, "게스트 쿠키 소유자가 자기 개별 응답을 불러오지 못했습니다.");
  const editOne = await fetch(`${baseUrl}/api/public/forms/${multi.slug}/responses/${first.id}`, {
    method: "PATCH", headers: jsonHeaders(multi, { Cookie: multiGuestCookie }), body: JSON.stringify({ answers: { [multiField.id]: { textValue: "첫 응답만 수정" } } }),
  });
  assert.equal(editOne.status, 200, "복수 응답의 개별 PATCH가 거부됐습니다.");
  const answers = await prisma.formAnswer.findMany({ where: { responseId: { in: [first.id, second.id] } }, select: { responseId: true, textValue: true } });
  assert.equal(answers.find((answer) => answer.responseId === first.id)?.textValue, "첫 응답만 수정");
  assert.equal(answers.find((answer) => answer.responseId === second.id)?.textValue, "둘째 응답", "다른 복수 응답까지 함께 수정됐습니다.");
}

async function checkYearlessDate(owner: string) {
  const form = await createForm(owner);
  const field = await prisma.formField.create({
    data: { formId: form.id, type: "DATE", title: "생일", position: 0, required: true, includeYear: false, includeTime: false },
  });
  const invalid = await fetch(`${baseUrl}/api/public/forms/${form.slug}/responses`, {
    method: "POST", headers: jsonHeaders(form),
    body: JSON.stringify({ answers: { [field.id]: { dateValue: "02-31" } } }),
  });
  assert.equal(invalid.status, 400, "달력에 없는 연도 없는 날짜가 통과했습니다.");

  const valid = await fetch(`${baseUrl}/api/public/forms/${form.slug}/responses`, {
    method: "POST", headers: jsonHeaders(form),
    body: JSON.stringify({ answers: { [field.id]: { dateValue: "02-29" } } }),
  });
  assert.equal(valid.status, 201, "정상 연도 없는 날짜가 거부됐습니다.");
  const saved = await valid.json();
  const answer = await prisma.formAnswer.findFirstOrThrow({ where: { responseId: saved.response.id, fieldId: field.id } });
  assert.equal(answer.dateValue, null, "연도 없는 날짜에 임의 연도가 저장됐습니다.");
  assert.equal(answer.timeValue, "02-29", "연도 없는 날짜 문자열이 보존되지 않았습니다.");
}

async function checkPayloadLimit(owner: string) {
  const form = await createForm(owner);
  const field = await addShortText(form.id, false);
  const oversized = "x".repeat(3 * 1024 * 1024 + 1);
  const response = await fetch(`${baseUrl}/api/public/forms/${form.slug}/responses`, {
    method: "POST", headers: jsonHeaders(form),
    body: JSON.stringify({ answers: { [field.id]: { textValue: oversized } } }),
  });
  assert.equal(response.status, 413, "3MB를 넘는 제출 본문이 거부되지 않았습니다.");
}

/** requiresLogin이면 로그인 없이는 401, 로그인하면 respondentId가 실제 계정으로 남아야 합니다. */
async function checkLoginRequired(owner: string, respondentId: string, authVersion: number) {
  const form = await createForm(owner, { requiresLogin: true });
  const field = await addShortText(form.id, false);

  const anonymous = await fetch(`${baseUrl}/api/public/forms/${form.slug}/responses`, {
    method: "POST", headers: jsonHeaders(form),
    body: JSON.stringify({ answers: { [field.id]: { textValue: "익명" } } }),
  });
  assert.equal(anonymous.status, 401, "로그인 필요 설문에 익명 제출이 통과했습니다.");

  const secret = process.env.AUTH_SECRET;
  if (!secret) throw new Error("AUTH_SECRET 환경 변수가 필요합니다.");
  const token = await encode({
    secret, maxAge: 300,
    token: { userId: respondentId, authVersion, sessionInvalid: false, onboardingCompleted: true, onboardingState: "COMPLETE" },
  });
  const loggedIn = await fetch(`${baseUrl}/api/public/forms/${form.slug}/responses`, {
    method: "POST",
    headers: {
      ...jsonHeaders(form),
      Cookie: `next-auth.session-token=${token}; __Secure-next-auth.session-token=${token}`,
    },
    body: JSON.stringify({ answers: { [field.id]: { textValue: "로그인 제출" } } }),
  });
  assert.equal(loggedIn.status, 201, "로그인 제출이 거부됐습니다.");
  const { response } = await loggedIn.json();
  const saved = await prisma.formResponse.findUniqueOrThrow({ where: { id: response.id }, select: { respondentId: true, guestTokenHash: true } });
  assert.equal(saved.respondentId, respondentId, "로그인 제출인데 respondentId가 저장되지 않았습니다.");
  assert.equal(saved.guestTokenHash, null, "로그인 제출인데 게스트 해시가 함께 저장됐습니다.");
}

async function checkFileUpload(owner: string, respondentId: string, authVersion: number) {
  const form = await createForm(owner, { requiresLogin: true });
  const field = await prisma.formField.create({ data: { formId: form.id, type: "FILE_UPLOAD", title: "자료", position: 0, required: true } });
  const secret = process.env.AUTH_SECRET;
  if (!secret) throw new Error("AUTH_SECRET 환경 변수가 필요합니다.");
  const token = await encode({ secret, maxAge: 300, token: { userId: respondentId, authVersion, sessionInvalid: false, onboardingCompleted: true, onboardingState: "COMPLETE" } });
  const cookie = `next-auth.session-token=${token}; __Secure-next-auth.session-token=${token}`;
  const anonymousBody = new FormData();
  anonymousBody.append("file", new Blob(["forms upload check"], { type: "text/plain" }), "answer.txt");
  const anonymous = await fetch(`${baseUrl}/api/public/forms/${form.slug}/fields/${field.id}/files`, { method: "POST", headers: { Origin: requestOrigin, "CF-Connecting-IP": form.clientIp }, body: anonymousBody });
  assert.equal(anonymous.status, 401, "로그인하지 않은 사용자가 파일 질문에 업로드했습니다.");

  const body = new FormData();
  body.append("file", new Blob(["forms upload check"], { type: "text/plain" }), "answer.txt");
  const upload = await fetch(`${baseUrl}/api/public/forms/${form.slug}/fields/${field.id}/files`, { method: "POST", headers: { Origin: requestOrigin, Cookie: cookie, "CF-Connecting-IP": form.clientIp }, body });
  assert.equal(upload.status, 201, "로그인 사용자의 정상 설문 파일 업로드가 거부됐습니다.");
  const uploaded = (await upload.json()).file;
  const row = await prisma.formUploadedFile.findUniqueOrThrow({ where: { id: uploaded.id } });
  uploadedStoragePaths.push(row.storagePath);

  const submit = await fetch(`${baseUrl}/api/public/forms/${form.slug}/responses`, {
    method: "POST", headers: jsonHeaders(form, { Cookie: cookie }), body: JSON.stringify({ answers: { [field.id]: { fileIds: [uploaded.id] } } }),
  });
  assert.equal(submit.status, 201, "업로드한 파일을 답변에 귀속하지 못했습니다.");
  const attached = await prisma.formUploadedFile.findUniqueOrThrow({ where: { id: uploaded.id } });
  assert.ok(attached.answerId && attached.responseId, "파일이 제출 응답과 답변에 귀속되지 않았습니다.");
  const download = await fetch(`${baseUrl}/form-files/${uploaded.id}`, { headers: { Cookie: cookie } });
  assert.equal(download.status, 200, "응답자가 자기 설문 파일을 내려받지 못했습니다.");
  assert.equal(await download.text(), "forms upload check");
}

/** 브라우저가 보내는 간결한 그리드 값에 서버가 행·보기 문구 스냅샷을 붙여 저장해야 합니다. */
async function checkGridSubmit(owner: string) {
  const form = await createForm(owner);
  const field = await prisma.formField.create({
    data: {
      formId: form.id,
      type: "MULTIPLE_CHOICE_GRID",
      title: "수업 만족도",
      position: 0,
      required: true,
      gridRows: ["수업", "자료"],
      gridRequireOneResponsePerRow: true,
    },
  });
  const options = await Promise.all([
    prisma.formFieldOption.create({ data: { fieldId: field.id, text: "좋음", position: 0 } }),
    prisma.formFieldOption.create({ data: { fieldId: field.id, text: "보통", position: 1 } }),
  ]);

  const submit = await fetch(`${baseUrl}/api/public/forms/${form.slug}/responses`, {
    method: "POST",
    headers: jsonHeaders(form),
    body: JSON.stringify({
      answers: {
        [field.id]: {
          gridValue: [
            { row: 0, optionIds: [options[0].id] },
            { row: 1, optionIds: [options[1].id] },
          ],
        },
      },
    }),
  });
  assert.equal(submit.status, 201, "정상 객관식 그리드 응답이 거부됐습니다.");
  const saved = await submit.json();
  const answer = await prisma.formAnswer.findFirstOrThrow({
    where: { responseId: saved.response.id, fieldId: field.id },
    select: { gridValue: true },
  });
  assert.deepEqual(answer.gridValue, [
    { row: 0, rowLabel: "수업", optionIds: [options[0].id], optionTexts: ["좋음"] },
    { row: 1, rowLabel: "자료", optionIds: [options[1].id], optionTexts: ["보통"] },
  ], "그리드 응답의 행·보기 스냅샷이 정확히 저장되지 않았습니다.");
}

/** signature_pad의 압력·상대 시간과 한 점짜리 획이 공개 제출 경로에서도 보존돼야 합니다. */
async function checkSignatureSubmit(owner: string) {
  const form = await createForm(owner);
  const field = await prisma.formField.create({
    data: { formId: form.id, type: "SIGNATURE", title: "서명", position: 0, required: true },
  });
  const signatureStrokes = [
    [{ x: 0.1254, y: 0.2555, pressure: 0.45, time: 1 }, { x: 0.8, y: 0.75, pressure: 0.7, time: 81 }],
    [{ x: 0.5, y: 0.4, time: 1 }],
  ];
  const submit = await fetch(`${baseUrl}/api/public/forms/${form.slug}/responses`, {
    method: "POST",
    headers: jsonHeaders(form),
    body: JSON.stringify({ answers: { [field.id]: { signatureStrokes } } }),
  });
  assert.equal(submit.status, 201, "정상 서명 응답이 거부됐습니다.");
  const saved = await submit.json();
  const answer = await prisma.formAnswer.findFirstOrThrow({
    where: { responseId: saved.response.id, fieldId: field.id },
    select: { signatureStrokes: true },
  });
  assert.deepEqual(answer.signatureStrokes, [
    [{ x: 0.125, y: 0.256, pressure: 0.45, time: 1 }, { x: 0.8, y: 0.75, pressure: 0.7, time: 81 }],
    [{ x: 0.5, y: 0.4, time: 1 }],
  ], "서명 좌표·압력·상대 시간이 정확히 저장되지 않았습니다.");
}

/**
 * 프록시의 전역 쓰기 백스톱은 `/api/public/*`를 건너뛰므로 이 라우트의 레이트리밋이 유일한
 * 방어선입니다. 이전 검사들이 이미 이 IP의 form-submit 버킷을 몇 번 썼는지 정확히 알 수
 * 없으므로(같은 프로세스에서 도는 dev 서버의 인메모리 상태), 여유 있게 연속 15회를 보내
 * "실제로 걸리기는 하는지"만 확인합니다.
 */
async function checkRateLimit(owner: string) {
  const form = await createForm(owner);
  const field = await addShortText(form.id, false);

  const statuses: number[] = [];
  for (let attempt = 0; attempt < 15; attempt += 1) {
    const response = await fetch(`${baseUrl}/api/public/forms/${form.slug}/responses`, {
      method: "POST", headers: jsonHeaders(form),
      body: JSON.stringify({ answers: { [field.id]: { textValue: `시도 ${attempt}` } } }),
    });
    statuses.push(response.status);
    if (response.status === 429) break;
  }
  assert.ok(statuses.includes(429), `15회 연속 제출에도 레이트리밋이 걸리지 않았습니다(응답: ${statuses.join(",")}).`);
}

void main().catch(async (error) => {
  console.error(error);
  await prisma.$disconnect();
  process.exit(1);
});
