import "../lib/load-env";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { createFormActivity, deleteFormFixture } from "./fixtures";
import { getPrisma } from "../lib/prisma";
import { dedupeKeyFor, hashGuestToken } from "../lib/forms/guest-access";
import { safeRegexTest, validateAnswer } from "../lib/forms/validation";
import {
  parseSignatureStrokes,
  quantizeSignatureStrokes,
  signaturePadDataToStrokes,
  signatureStrokesToPadPoints,
  strokesToSvgPath,
} from "../lib/forms/signature";
import { formSaveSchema } from "../lib/forms/field-schema";
import { shouldClearCloseAt } from "../lib/forms/access";
import { submitResponseSchema } from "../lib/forms/response-schema";
import { shuffledCopy } from "../lib/forms/shuffle";
import { requiredCompletion } from "../lib/forms/progress";
import { formClosedMessage, parseGridInputValue } from "../lib/forms/field-types";

// 설문 도메인의 스키마 제약이 실제로 걸리는지 확인합니다.
//
//   NODE_OPTIONS=--conditions=react-server yarn verify:forms-schema
//
// 여기서 증명하려는 것은 "응용 코드가 잘 짜여 있다"가 아니라 **응용 코드가 틀려도 DB가 막는다**
// 입니다. 1인 1응답은 응용 코드의 "조회 후 없으면 생성"으로는 동시 요청을 막을 수 없어서,
// 그 방어선이 정말 DB에 있는지 확인하지 않으면 있다고 믿기만 하게 됩니다.

const prisma = getPrisma();

async function main() {
  const owner = await prisma.user.findFirst({ where: { status: "ACTIVE" }, select: { id: true } });
  if (!owner) throw new Error("검증에 사용할 활성 사용자가 없습니다.");

  const title = `설문 스키마 검증 ${randomUUID().slice(0, 8)}`;
  const activityId = await createFormActivity(prisma, owner.id, title);
  const form = await prisma.form.create({
    data: { ownerId: owner.id, activityId, slug: `verify-form-${randomUUID()}`, title },
    select: { id: true },
  });

  try {
    const field = await prisma.formField.create({
      data: { formId: form.id, type: "SHORT_TEXT", title: "이름", position: 0, required: true },
      select: { id: true },
    });

    await checkSingleResponsePerPerson(form.id);
    await checkMultipleResponsesAllowed(form.id);
    await checkGuestDedupe(form.id);
    await checkAnswerBlocksFieldDelete(form.id, field.id);
    await checkActivityIsRequired(owner.id);
    await checkDeleteOrder(owner.id);
    checkValidationRules();
    checkSignature();
    checkRegexSafety();
    checkScheduleWindow();
    checkCloseAtReopenPolicy();
    checkClosedMessagePolicy();

    console.log("forms_schema_checks=passed");
  } finally {
    await deleteFormFixture(prisma, form.id, activityId).catch(() => undefined);
    await prisma.$disconnect();
  }
}

/** allowMultipleResponses=false면 같은 사람이 두 번 낼 수 없어야 합니다. */
async function checkSingleResponsePerPerson(formId: string) {
  const dedupeKey = dedupeKeyFor({ allowMultipleResponses: false, respondentId: "user-a" });
  assert.equal(dedupeKey, "u:user-a", "로그인 응답자의 dedupeKey는 respondentId에서 나와야 합니다.");

  await prisma.formResponse.create({ data: { formId, dedupeKey, submittedAt: new Date() } });
  await assert.rejects(
    () => prisma.formResponse.create({ data: { formId, dedupeKey, submittedAt: new Date() } }),
    (error: { code?: string }) => error.code === "P2002",
    "같은 dedupeKey로 두 번째 응답이 들어갔습니다 — 1인 1응답이 DB에서 막히지 않습니다.",
  );
}

/** allowMultipleResponses=true면 dedupeKey가 null이라 몇 번이든 낼 수 있어야 합니다. */
async function checkMultipleResponsesAllowed(formId: string) {
  const dedupeKey = dedupeKeyFor({ allowMultipleResponses: true, respondentId: "user-b" });
  assert.equal(dedupeKey, null, "복수 응답을 허용하면 dedupeKey가 null이어야 합니다.");

  // PostgreSQL이 유니크 인덱스에서 null을 서로 다른 값으로 보는 것에 기대는 지점입니다.
  // 이 성질이 깨지면 복수 응답 설문이 두 번째 제출부터 통째로 막힙니다.
  await prisma.formResponse.create({ data: { formId, dedupeKey, submittedAt: new Date() } });
  await prisma.formResponse.create({ data: { formId, dedupeKey, submittedAt: new Date() } });

  const count = await prisma.formResponse.count({ where: { formId, dedupeKey: null } });
  assert.equal(count, 2, "복수 응답 허용 설문에서 두 건이 모두 남아야 합니다.");
}

/** 익명 응답자도 쿠키 해시로 같은 방어선을 받아야 합니다. */
async function checkGuestDedupe(formId: string) {
  const guestTokenHash = hashGuestToken("verify-guest-token");
  const dedupeKey = dedupeKeyFor({ allowMultipleResponses: false, guestTokenHash });
  assert.equal(dedupeKey, `g:${guestTokenHash}`, "익명 응답자의 dedupeKey는 쿠키 해시에서 나와야 합니다.");
  assert.equal(guestTokenHash.length, 64, "sha256 해시는 64자여야 합니다(원문 토큰은 저장하지 않습니다).");

  await prisma.formResponse.create({ data: { formId, guestTokenHash, dedupeKey, submittedAt: new Date() } });
  await assert.rejects(
    () => prisma.formResponse.create({ data: { formId, guestTokenHash, dedupeKey, submittedAt: new Date() } }),
    (error: { code?: string }) => error.code === "P2002",
    "같은 게스트 쿠키로 두 번째 응답이 들어갔습니다.",
  );
}

/** 응답이 달린 질문은 지워지지 않아야 합니다(FormAnswer.fieldId = RESTRICT). */
async function checkAnswerBlocksFieldDelete(formId: string, fieldId: string) {
  const response = await prisma.formResponse.create({
    data: { formId, dedupeKey: `u:${randomUUID()}`, submittedAt: new Date() },
    select: { id: true },
  });
  await prisma.formAnswer.create({
    data: { responseId: response.id, fieldId, fieldType: "SHORT_TEXT", fieldTitle: "이름", textValue: "홍길동" },
  });

  await assert.rejects(
    () => prisma.formField.delete({ where: { id: fieldId } }),
    (error: { code?: string }) => error.code === "P2003",
    "응답이 달린 질문이 그냥 지워졌습니다 — 저장 API의 확인 절차가 무력해집니다.",
  );

  // 답변을 먼저 지우면 지워집니다. 저장 API의 confirmDestructive 경로가 밟는 순서입니다.
  await prisma.formAnswer.deleteMany({ where: { fieldId } });
  await prisma.formField.delete({ where: { id: fieldId } });
}

/** Form.activityId는 필수라 활동 없이는 설문이 만들어지지 않아야 합니다. */
async function checkActivityIsRequired(ownerId: string) {
  await assert.rejects(
    () =>
      prisma.form.create({
        // activityId를 빼면 타입에서 이미 막히므로, 없는 활동을 가리켜 FK가 사는지 봅니다.
        data: { ownerId, activityId: `missing-${randomUUID()}`, slug: `verify-orphan-${randomUUID()}`, title: "고아" },
      }),
    (error: { code?: string }) => error.code === "P2003",
    "존재하지 않는 활동을 가리키는 설문이 만들어졌습니다.",
  );
}

/**
 * 설문을 통째로 지울 때는 답변을 먼저 지워야 합니다.
 *
 * Activity를 지우면 cascade가 Form → FormField로 내려가는데, FormAnswer.fieldId가 RESTRICT라
 * 답변이 남아 있으면 그 지점에서 걸립니다. 응답 쪽 cascade(FormResponse → FormAnswer)가 먼저
 * 끝난다는 보장이 없어서 실제로 실패합니다 — 이 검사는 그 순서 요구가 지금도 유효한지를
 * 붙잡아 둡니다. 어느 날 조용히 통과하기 시작하면 fixtures.ts와 영구 삭제 경로의 주석이
 * 낡았다는 뜻입니다.
 */
async function checkDeleteOrder(ownerId: string) {
  const activityId = await createFormActivity(prisma, ownerId, `설문 삭제 순서 검증 ${randomUUID().slice(0, 8)}`);
  const form = await prisma.form.create({
    data: { ownerId, activityId, slug: `verify-order-${randomUUID()}`, title: "삭제 순서" },
    select: { id: true },
  });
  const field = await prisma.formField.create({
    data: { formId: form.id, type: "SHORT_TEXT", title: "질문", position: 0 },
    select: { id: true },
  });
  const response = await prisma.formResponse.create({
    data: { formId: form.id, dedupeKey: `u:${randomUUID()}`, submittedAt: new Date() },
    select: { id: true },
  });
  await prisma.formAnswer.create({
    data: { responseId: response.id, fieldId: field.id, fieldType: "SHORT_TEXT", fieldTitle: "질문", textValue: "값" },
  });

  await assert.rejects(
    () => prisma.activity.delete({ where: { id: activityId } }),
    (error: { code?: string }) => error.code === "P2003",
    "답변이 남아 있는데 활동이 그냥 지워졌습니다 — fixtures.ts의 삭제 순서 주석이 낡았습니다.",
  );

  // 답변을 먼저 지우면 활동 하나로 전부 내려갑니다.
  await deleteFormFixture(prisma, form.id, activityId);
  assert.equal(await prisma.form.count({ where: { id: form.id } }), 0, "설문이 cascade로 지워지지 않았습니다.");
  assert.equal(await prisma.formResponse.count({ where: { formId: form.id } }), 0, "응답이 cascade로 지워지지 않았습니다.");
}

/** 응답 확인은 화면과 서버가 같은 함수를 씁니다. 대표적인 규칙만 훑습니다. */
function checkValidationRules() {
  const base = {
    required: true,
    allowOther: false,
    optionIds: [] as string[],
    gridRows: [],
    gridRequireOneResponsePerRow: false,
    scaleMin: null,
    scaleMax: null,
    ratingMax: null,
    includeYear: true,
    includeTime: false,
    durationMode: false,
    validation: null as unknown,
  };

  const shortText = { ...base, type: "SHORT_TEXT" as const };
  assert.equal(validateAnswer(shortText, { textValue: "" }), "필수 항목입니다.", "필수 검사가 비어 있는 값을 잡아야 합니다.");
  assert.equal(validateAnswer({ ...shortText, required: false }, { textValue: "" }), null, "선택 항목의 빈 값은 통과해야 합니다.");

  const email = { ...shortText, validation: { kind: "text", op: "email" } };
  assert.equal(validateAnswer(email, { textValue: "hong@example.com" }), null, "정상 이메일이 막혔습니다.");
  assert.ok(validateAnswer(email, { textValue: "hong@example" }), "형식이 어긋난 이메일이 통과했습니다.");

  const between = { ...shortText, validation: { kind: "number", op: "between", value: 1, value2: 10 } };
  assert.equal(validateAnswer(between, { textValue: "5" }), null, "범위 안의 숫자가 막혔습니다.");
  assert.ok(validateAnswer(between, { textValue: "50" }), "범위 밖의 숫자가 통과했습니다.");

  // 체크박스의 선택 개수 규칙. 다른 유형에는 붙지 않아야 합니다.
  const checkboxes = {
    ...base, type: "CHECKBOXES" as const, optionIds: ["a", "b"],
    validation: { kind: "count", op: "min", value: 2 },
  };
  assert.ok(validateAnswer(checkboxes, { selectedOptionIds: ["a"] }), "최소 개수 미달이 통과했습니다.");
  assert.equal(validateAnswer(checkboxes, { selectedOptionIds: ["a", "b"] }), null, "개수를 채운 응답이 막혔습니다.");
  assert.equal(
    validateAnswer({ ...shortText, validation: { kind: "count", op: "min", value: 2 } }, { textValue: "가" }),
    null,
    "단답형에 붙을 수 없는 개수 규칙이 적용됐습니다.",
  );

  // CHECKBOXES는 예전에 shape 검사 자체가 빠져 있어서, 존재하지 않는 보기 ID나 중복 ID가
  // 그냥 통과했습니다. 여기서 그 구멍이 막혔는지 직접 확인합니다.
  const openChoices = { ...base, type: "MULTIPLE_CHOICE" as const, optionIds: ["a", "b"] };
  assert.equal(validateAnswer(openChoices, { selectedOptionIds: ["a"] }), null, "실제 보기를 고른 응답이 막혔습니다.");
  assert.ok(validateAnswer(openChoices, { selectedOptionIds: ["ghost"] }), "존재하지 않는 보기 ID가 통과했습니다.");
  assert.ok(
    validateAnswer({ ...checkboxes, validation: null }, { selectedOptionIds: ["ghost"] }),
    "체크박스에서 존재하지 않는 보기 ID가 통과했습니다 — 예전에 없던 shape 검사입니다.",
  );
  assert.ok(
    validateAnswer({ ...checkboxes, validation: null }, { selectedOptionIds: ["a", "a"] }),
    "같은 보기를 두 번 고른 응답이 통과했습니다.",
  );

  // 그리드도 열이 곧 보기이므로 같은 방어가 적용돼야 합니다.
  const grid = {
    ...base, type: "MULTIPLE_CHOICE_GRID" as const, optionIds: ["col-a", "col-b"], gridRows: ["1행", "2행"],
  };
  assert.equal(
    validateAnswer(grid, { gridValue: [{ row: 0, optionIds: ["col-a"] }] }),
    null,
    "정상 그리드 응답이 막혔습니다.",
  );
  assert.ok(
    validateAnswer(grid, { gridValue: [{ row: 0, optionIds: ["ghost"] }] }),
    "그리드에서 존재하지 않는 열 ID가 통과했습니다.",
  );
  assert.deepEqual(
    parseGridInputValue([{ row: 1, optionIds: ["col-b"] }]),
    [{ row: 1, optionIds: ["col-b"] }],
    "저장 전 그리드 응답을 DB 스냅샷 형태로 잘못 파싱했습니다.",
  );

  // 화면을 우회해 보낸 값이 서버에서 걸리는지 — 척도 범위 밖의 숫자.
  const scale = { ...base, type: "LINEAR_SCALE" as const, scaleMin: 1, scaleMax: 5 };
  assert.equal(validateAnswer(scale, { numberValue: 3 }), null, "범위 안의 눈금이 막혔습니다.");
  assert.ok(validateAnswer(scale, { numberValue: 99 }), "척도 범위를 벗어난 값이 통과했습니다.");

  // 시각·기간은 같은 문자열 칸을 쓰지만 형식이 다릅니다.
  const time = { ...base, type: "TIME" as const };
  assert.equal(validateAnswer(time, { timeValue: "14:30" }), null, "정상 시각이 막혔습니다.");
  assert.ok(validateAnswer(time, { timeValue: "25:00" }), "존재하지 않는 시각이 통과했습니다.");
  assert.equal(validateAnswer({ ...time, durationMode: true }, { timeValue: "25:00" }), null, "기간 25시간이 막혔습니다.");

  const date = { ...base, type: "DATE" as const };
  assert.equal(validateAnswer(date, { dateValue: "2028-02-29" }), null, "정상 윤년 날짜가 막혔습니다.");
  assert.ok(validateAnswer(date, { dateValue: "2026-02-31" }), "달력에 없는 날짜가 통과했습니다.");
  assert.equal(validateAnswer({ ...date, includeYear: false }, { dateValue: "02-29" }), null, "연도 없는 날짜가 막혔습니다.");
  assert.ok(validateAnswer({ ...date, includeYear: false }, { dateValue: "13-01" }), "연도 없는 날짜의 잘못된 월이 통과했습니다.");
  assert.equal(
    validateAnswer({ ...date, includeTime: true }, { dateValue: "2026-08-11T09:30:00.000Z" }),
    null,
    "ISO 날짜·시간이 막혔습니다.",
  );
  assert.ok(
    validateAnswer({ ...date, includeTime: true }, { dateValue: "2026-08-11T09:30" }),
    "타임존 없는 날짜·시간이 서버에서 통과했습니다.",
  );
  assert.ok(
    validateAnswer({ ...date, includeTime: true }, { dateValue: "2026-02-31T09:30:00.000Z" }),
    "시간 포함 값에서 달력에 없는 날짜가 통과했습니다.",
  );

  // 설명 블록은 응답을 받지 않으므로 필수여도 통과해야 합니다.
  assert.equal(validateAnswer({ ...base, type: "SECTION_HEADER" as const }, {}), null, "설명 블록이 필수 검사에 걸렸습니다.");

  const tooManyAnswers = Object.fromEntries(Array.from({ length: 201 }, (_, index) => [`field-${index}`, {}]));
  assert.equal(submitResponseSchema.safeParse({ answers: tooManyAnswers }).success, false, "질문 수 상한을 넘는 답변 맵이 통과했습니다.");

  const source = ["a", "b", "c", "d"];
  assert.deepEqual(shuffledCopy(source, false, () => 0), source, "섞기 비활성 상태에서 순서가 바뀌었습니다.");
  assert.deepEqual(shuffledCopy(source, true, () => 0), ["b", "c", "d", "a"], "Fisher-Yates 셔플 결과가 예상과 다릅니다.");
  assert.deepEqual(source, ["a", "b", "c", "d"], "셔플이 원본 배열을 변경했습니다.");

  const progress = requiredCompletion(
    [{ required: true, done: false }, { required: true, done: true }, { required: false, done: true }],
    (field) => field.done,
  );
  assert.deepEqual(progress, { completed: 1, total: 2, percent: 50 }, "선택 문항이 필수 문항 진행률에 포함됐습니다.");
}

/** 서명은 좌표 JSON입니다. 정규화 범위를 벗어난 값은 저장 전에 걸러야 합니다. */
function checkSignature() {
  const strokes = [[{ x: 0.1234, y: 0.5678 }, { x: 0.2, y: 0.6 }]];
  const quantized = quantizeSignatureStrokes(strokes);
  assert.deepEqual(quantized[0][0], { x: 0.123, y: 0.568 }, "좌표가 소수 셋째 자리로 줄지 않았습니다.");

  assert.equal(parseSignatureStrokes([[{ x: 2, y: 0 }, { x: 0, y: 0 }]]).length, 0, "0~1을 벗어난 좌표가 통과했습니다.");
  assert.equal(parseSignatureStrokes([[{ x: 0.5, y: 0.5 }]]).length, 1, "signature_pad의 점 획이 보존되지 않았습니다.");
  assert.equal(parseSignatureStrokes("서명").length, 0, "문자열이 서명으로 통과했습니다.");

  const normalized = signaturePadDataToStrokes([{
    points: [
      { x: 100, y: 50, pressure: 0.4, time: 1000 },
      { x: 150, y: 75, pressure: 0.6, time: 1025 },
    ],
  }], 200, 100);
  assert.deepEqual(normalized, [[
    { x: 0.5, y: 0.5, pressure: 0.4, time: 1 },
    { x: 0.75, y: 0.75, pressure: 0.6, time: 26 },
  ]], "signature_pad 좌표가 저장용 비율 좌표로 바뀌지 않았습니다.");
  assert.deepEqual(signatureStrokesToPadPoints(normalized, 400, 200)[0].points, [
    { x: 200, y: 100, pressure: 0.4, time: 1 },
    { x: 300, y: 150, pressure: 0.6, time: 26 },
  ], "다른 크기의 서명 패드에서 비율 좌표를 복원하지 못했습니다.");
  assert.equal(submitResponseSchema.safeParse({ answers: { signature: { signatureStrokes: [] } } }).success, true, "서명을 지운 선택 항목이 제출 스키마에서 거부됐습니다.");

  const path = strokesToSvgPath(quantized, 100, 50);
  assert.equal(path, "M12.3 28.4 L20 30", "SVG path가 예상과 다릅니다.");
}

/**
 * 중첩 수량자 패턴이 아예 실행되지 않고 즉시 null(판정 불가 → 통과)로 빠지는지 확인합니다.
 *
 * 이 검사가 없으면 `(a+)+$` 같은 패턴이 실제로 실행되어 이 스크립트 자체가 멈춰 버립니다 —
 * 그래서 "위험한 패턴이 걸러진다"만 보고, 걸러지지 않는 정상 패턴까지 막히지는 않는지도
 * 함께 봅니다.
 */
function checkRegexSafety() {
  const start = Date.now();
  assert.equal(safeRegexTest("(a+)+$", "a".repeat(40) + "!"), null, "중첩 수량자 패턴이 실행됐습니다.");
  assert.equal(safeRegexTest("(a*)*", "a".repeat(40) + "!"), null, "중첩 수량자 패턴이 실행됐습니다.");
  assert.equal(safeRegexTest("(a+){3,}", "a".repeat(40) + "!"), null, "반복 상한 없는 중첩 수량자가 실행됐습니다.");
  // 40자짜리 문자열에서 (a+)+$가 실제로 돌았다면 이 스크립트가 초 단위로 멈췄을 것입니다.
  assert.ok(Date.now() - start < 1000, "위험한 패턴 검사에 1초 넘게 걸렸습니다 — 실행을 막지 못했습니다.");

  // 안전한 패턴은 평소처럼 실행됩니다.
  assert.equal(safeRegexTest("^[a-z]+$", "hong"), true, "안전한 패턴이 잘못 막혔습니다.");
  assert.equal(safeRegexTest("^\\d{3}-\\d{4}$", "010-1234"), true, "형식에 맞는 값이 막혔습니다.");
  assert.equal(safeRegexTest("^\\d{3}-\\d{4}$", "010-12"), false, "형식이 다른 값이 통과했습니다.");
}

/** 편집기의 `datetime-local` 값이 아니라 서버가 받는 완전한 ISO 문자열 기준의 교차 검증입니다. */
function checkScheduleWindow() {
  const base = {
    title: "일정 검증", description: null, subjectName: null, requiresLogin: true,
    allowMultipleResponses: false, allowEditAfterSubmit: false, shuffleFields: false, showProgressBar: true,
    confirmationMessage: null, maxResponses: null,
    fields: [{ type: "SHORT_TEXT" as const, title: "q", description: null, required: false, validation: null }],
  };

  const ordered = formSaveSchema.safeParse({ ...base, openAt: "2026-01-01T00:00:00.000Z", closeAt: "2026-02-01T00:00:00.000Z" });
  assert.ok(ordered.success, "시작이 마감보다 이른 정상 값이 거부됐습니다.");

  const reversed = formSaveSchema.safeParse({ ...base, openAt: "2026-02-01T00:00:00.000Z", closeAt: "2026-01-01T00:00:00.000Z" });
  assert.equal(reversed.success, false, "마감이 시작보다 이른 값이 통과했습니다.");

  const openOnly = formSaveSchema.safeParse({ ...base, openAt: "2026-01-01T00:00:00.000Z", closeAt: null });
  assert.ok(openOnly.success, "마감 없는 예약 시작이 거부됐습니다.");
}

/** 발행 시 마감 시각을 지울지 — 이미 지난 마감만 지워야 첫 발행의 예약이 안 사라집니다. */
function checkCloseAtReopenPolicy() {
  const now = new Date("2026-06-15T00:00:00.000Z");
  assert.equal(shouldClearCloseAt(null, now), false, "마감이 없으면 지울 게 없어야 합니다.");
  assert.equal(
    shouldClearCloseAt(new Date("2026-07-01T00:00:00.000Z"), now),
    false,
    "미래로 예약된 마감이 발행 한 번에 지워졌습니다 — 첫 발행에서 설정한 예약이 사라집니다.",
  );
  assert.equal(
    shouldClearCloseAt(new Date("2026-05-01T00:00:00.000Z"), now),
    true,
    "이미 지난 마감이 재개 시 안 지워졌습니다 — 다시 열어도 곧바로 PAST_DUE로 되돌아갑니다.",
  );
}

/** 소유자 안내는 실제 접수가 끝난 상태에만 쓰고, 초안·시작 전 상태를 가리면 안 됩니다. */
function checkClosedMessagePolicy() {
  const custom = "다음 학기에 다시 신청해 주세요.";
  assert.equal(formClosedMessage("CLOSED", custom), custom);
  assert.equal(formClosedMessage("PAST_DUE", custom), custom);
  assert.equal(formClosedMessage("FULL", custom), custom);
  assert.equal(formClosedMessage("DRAFT", custom), "아직 발행되지 않은 설문입니다.");
  assert.equal(formClosedMessage("NOT_OPEN_YET", custom), "아직 응답을 받기 전입니다.");
  assert.equal(formClosedMessage("CLOSED", "  "), "마감된 설문입니다.");
}

void main().catch((error) => {
  console.error(error);
  process.exit(1);
});
