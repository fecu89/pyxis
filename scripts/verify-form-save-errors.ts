import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { after, mock, test } from "node:test";
import type { getPrisma } from "../lib/prisma";
import { encryptUserPii } from "../lib/security/pii-crypto-core";

// 실제 PUT·스키마·저장 오류 분류를 실행하고 세션 저장소·DB만 대체합니다.
// .env를 읽지 않으며 fixture에 없는 DB 작업은 구현하지 않아 실제 쓰기는 불가능합니다.
process.env.DATABASE_URL = "postgresql://test:test@127.0.0.1:1/unavailable";
process.env.AUTH_SECRET = "form-save-error-test";
process.env.PII_ACTIVE_KEY_ID = "test";
process.env.PII_ENCRYPTION_KEY_TEST = Buffer.alloc(32, 1).toString("base64");
process.env.PII_LOOKUP_KEY = Buffer.alloc(32, 2).toString("base64");
const moduleRequire = createRequire(`${process.cwd()}/package.json`);
mock.method(moduleRequire("next/headers"), "headers", async () => new Headers());
mock.method(moduleRequire("next-auth/next"), "getServerSession", async () => ({ user: { id: "owner" } }));

const transaction = {
  $queryRaw: async () => [{ id: "fixture" }],
  form: { findUniqueOrThrow: async () => ({ id: "fixture", ownerId: "owner", updatedAt: new Date("2026-09-17T00:00:00.000Z") }) },
  formField: { findMany: async () => [{ id: "field", options: [] }] },
};
const database = {
  user: { findUnique: async () => ({
    id: "owner", loginIdentifierEncrypted: encryptUserPii("owner", "email", "test-owner"),
    nameEncrypted: null, imageEncrypted: null, role: "TEACHER", status: "ACTIVE",
    registrationApprovalStatus: "APPROVED", registrationReviewReason: null, registrationReviewedAt: null,
    authVersion: 0, passwordHash: "test-hash", mustChangePassword: false, studentNumber: null,
    onboardingCompletedAt: new Date(), createdAt: new Date(), lastLoginAt: null,
    systemPermissions: [], school: null, schoolGroup: null, isSchoolRepresentative: false,
  }) },
  form: { findUnique: async () => ({ id: "fixture", ownerId: "owner", deletedAt: null, frozenAt: null, shares: [] }) },
  $transaction: async (run: (tx: typeof transaction) => Promise<unknown>) => run(transaction),
};
const globals = globalThis as unknown as { pyxCoursePrisma?: ReturnType<typeof getPrisma> };
globals.pyxCoursePrisma = database as unknown as ReturnType<typeof getPrisma>;
after(() => { mock.restoreAll(); delete globals.pyxCoursePrisma; });

const field = { id: "field", type: "FILE_UPLOAD", title: "첨부", description: null, required: false, fileMaxCount: 1, fileMaxSizeMb: 10, fileAllowedTypes: ["PDF"] };
const document = {
  title: "검증", description: null, subjectName: null, requiresLogin: true,
  allowMultipleResponses: false, allowEditAfterSubmit: false, shuffleFields: false,
  showProgressBar: true, confirmationMessage: null, openAt: null, closeAt: null,
  maxResponses: null, fields: [field], expectedUpdatedAt: "2026-09-17T00:00:00.000Z",
};
async function save(body: unknown, raw = false) {
  const { PUT } = await import("../app/api/forms/[formId]/route");
  return PUT(new Request("http://localhost/api/forms/fixture", {
    method: "PUT", headers: { "Content-Type": "application/json" },
    body: raw ? String(body) : JSON.stringify(body),
  }), { params: Promise.resolve({ formId: "fixture" }) });
}

test("파일 유형 검증 오류만 FORM_VALIDATION_ERROR로 구분한다", async () => {
  const response = await save({ ...document, fields: [{ ...field, fileAllowedTypes: [] }] });
  assert.equal(response.status, 400);
  assert.deepEqual(await response.json(), {
    code: "FORM_VALIDATION_ERROR", error: "허용할 파일 유형을 1개 이상 선택해 주세요.",
  });
});

test("질문 ID 불일치의 새로고침 안내는 입력 검증으로 분류하지 않는다", async () => {
  const response = await save({ ...document, fields: [{ ...field, id: "unknown-field" }] });
  assert.equal(response.status, 400);
  const body = await response.json();
  assert.equal(body.code, undefined);
  assert.match(body.error, /질문 목록.*새로고침/);
});

test("보기 ID 불일치의 새로고침 안내는 입력 검증으로 분류하지 않는다", async () => {
  const response = await save({ ...document, fields: [{
    id: "field", type: "MULTIPLE_CHOICE", title: "선택", description: null, required: false,
    shuffleOptions: false, allowOther: false, options: [{ id: "unknown-option", text: "보기" }],
  }] });
  assert.equal(response.status, 400);
  const body = await response.json();
  assert.equal(body.code, undefined);
  assert.match(body.error, /보기 목록.*새로고침/);
});

test("문서 버전 충돌은 기존 409 needsReload를 유지한다", async () => {
  const response = await save({ ...document, expectedUpdatedAt: "2026-09-16T00:00:00.000Z" });
  assert.equal(response.status, 409);
  const body = await response.json();
  assert.equal(body.needsReload, true);
  assert.equal(body.code, undefined);
});

test("잘못된 JSON의 400은 입력 검증으로 분류하지 않는다", async () => {
  const response = await save("{", true);
  assert.equal(response.status, 400);
  assert.equal((await response.json()).code, undefined);
});
