// 실제 조회/권한 코드를 실행합니다. DB 경계만 대체하며 네트워크·운영 DB는 사용하지 않습니다.
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { createRequire } from "node:module";
import { test } from "node:test";
import { build } from "esbuild";

const require = createRequire(import.meta.url);
const actor = { id: "student-a", role: "STUDENT", status: "ACTIVE", systemPermissions: [] };
let db;
globalThis.learningTestDb = () => db;
let queries = {};
if (existsSync("lib/learning/queries.ts")) {
  const result = await build({
    stdin: { contents: 'export * from "./lib/learning/queries"; export * from "./lib/subjects/mutations"; export * from "./lib/subjects/resources"; export * from "./lib/board/subject-invite";', resolveDir: process.cwd() }, bundle: true, write: false, platform: "node", format: "cjs", packages: "external",
    plugins: [{ name: "database-boundary", setup(b) {
      b.onResolve({ filter: /^server-only$/ }, () => ({ path: "empty", namespace: "fixture" }));
      b.onResolve({ filter: /^@\/lib\/prisma$/ }, () => ({ path: "db", namespace: "fixture" }));
      b.onResolve({ filter: /^@\/lib\/auth\/authorization$/ }, () => ({ path: "auth", namespace: "fixture" }));
      b.onLoad({ filter: /.*/, namespace: "fixture" }, ({ path }) => ({ contents: path === "db"
        ? "export const getPrisma = () => globalThis.learningTestDb();"
        : path === "auth" ? "export class AuthorizationError extends Error {}; export const hasSystemPermission = () => false;" : "" }));
    } }],
  });
  const loadedModule = { exports: {} };
  new Function("require", "module", "exports", result.outputFiles[0].text)(require, loadedModule, loadedModule.exports);
  queries = loadedModule.exports;
}
const date = new Date("2026-09-21T00:00:00Z");
function available() { assert.equal(typeof queries.getLearningPage, "function", "학생용 학습 목록 조회가 아직 없습니다."); }

test("교과목 소유자와 개별/학급 수강생만 진입할 수 있다", async () => {
  available();
  let membershipChecks = 0;
  db = {
    subject: { findUnique: async () => ({ id: "course", name: "과학", ownerId: "teacher" }) },
    user: { count: async ({ where }) => { membershipChecks++; assert.equal(where.AND[0].id, "student-a"); return 1; } },
  };
  assert.equal((await queries.getCourseAccess("course", actor)).canManage, false);
  assert.equal(membershipChecks, 1);
  assert.equal((await queries.getCourseAccess("course", { ...actor, id: "teacher", role: "TEACHER" })).canManage, true);
  assert.equal(membershipChecks, 1, "소유자는 수강생 조회 없이 관리 권한 판정");
  db.user.count = async () => 0;
  assert.equal(await queries.getCourseAccess("course", actor), null);
});

test("다른 교과목 ID로 학습 목록을 조회해도 권한 확인 전에 콘텐츠를 읽지 않는다", async () => {
  available();
  db = { subject: { findUnique: async () => ({ id: "other", ownerId: "other-teacher" }) }, user: { count: async () => 0 } };
  await assert.rejects(queries.getLearningPage(actor, { kind: "quiz", subjectId: "other" }), /권한/);
});

test("학생 소유 교과목도 학습용으로만 열리고 관리 권한은 얻지 않는다", async () => {
  const course = { id: "course", name: "내 과목", ownerId: actor.id };
  db = { subject: { findUnique: async () => course, findMany: async () => [course] } };
  assert.equal((await queries.getCourseAccess("course", actor)).canManage, false);
  assert.equal((await queries.getLearningCourses(actor))[0].canManage, false);
  await assert.rejects(queries.requireOwnedSubject("course", actor), /권한/);
});

test("학생의 개인 교과목 분류는 명단 조회나 패드 자동 초대를 실행하지 않는다", async () => {
  db = {};
  assert.deepEqual(await queries.inviteSubjectRosterToBoard("pad", "old-owned-course", actor), { addedCount: 0 });
});

test("내게 할당된 퀴즈만 조회하고 원본 대신 풀이/본인 결과로 연결한다", async () => {
  available();
  db = { subject: { findMany: async () => [] }, quizSession: { count: async () => 0 }, quiz: { count: async () => 0 }, quizAssignment: {
    count: async ({ where }) => { assert.equal(where.studentId, actor.id); return 1; },
    findMany: async ({ where, select, take }) => {
      assert.equal(where.studentId, actor.id);
      assert.equal(where.quiz.deletedAt, null);
      assert.deepEqual(where.session.participants.some, { userId: actor.id, status: { not: "KICKED" } });
      assert.equal(select.quiz.select.questions, undefined, "문항·정답을 목록에 싣지 않는다");
      assert.equal(take, 1);
      return [Boolean(where.NOT)].map(complete => { const i = Number(complete); return ({ id: `a${i}`, createdAt: date,
        quiz: { title: `퀴즈 ${i}`, description: null, subject: { name: "과학" } },
        session: { id: `session${i}`, status: "LOBBY", openAt: null, dueAt: null, allowLateSubmission: false,
          participants: [{ status: complete ? "COMPLETED" : "IN_PROGRESS", currentQuestionIndex: 1 }] },
      }); });
    },
  } };
  const page = await queries.getLearningPage(actor, { kind: "quiz" });
  assert.deepEqual(page.items.map(x => x.href), ["/p/session0", "/quiz/activities/session1/report"]);
  assert.deepEqual(page.items.map(x => x.action), ["이어서 풀기", "결과 보기"]);
});

test("내 패드는 소유/멤버십으로 한정하고 삭제된 패드를 제외한다", async () => {
  available();
  db = { board: {
    count: async () => 1,
    findMany: async ({ where }) => {
      assert.equal(where.deletedAt, null);
      assert.deepEqual(where.OR, [{ ownerId: actor.id }, { members: { some: { userId: actor.id } } }]);
      return [{ id: "pad", title: "토론", description: null, slug: "pad-slug", subject: null, state: "ACTIVE" }];
    },
  } };
  assert.equal((await queries.getLearningPage(actor, { kind: "pad" })).items[0].href, "/b/pad-slug");
});

test("설문은 수강 교과목/본인 응답으로 한정하고 초안·타인 응답을 보내지 않는다", async () => {
  available();
  db = { form: {
    count: async () => 1,
    findMany: async ({ where, select }) => {
      assert.equal(where.deletedAt, null);
      assert.deepEqual(where.status, { in: ["OPEN", "CLOSED"] });
      assert.deepEqual(where.OR[1], { responses: { some: { respondentId: actor.id } } });
      assert.equal(where.OR[0].subject.is.OR[0].students.some.studentId, actor.id);
      assert.equal(select.responses.where.respondentId, actor.id);
      assert.equal(select.responses.select.answers, undefined);
      assert.equal(select.fields, undefined);
      return [{ id: "form", title: "수업 설문", description: null, slug: "form-slug", subject: { name: "과학" },
        status: "OPEN", openAt: null, closeAt: null, maxResponses: null, responseCount: 0, responses: [],
      }];
    },
  } };
  assert.equal((await queries.getLearningPage(actor, { kind: "form" })).items[0].href, "/s/form-slug");
});

test("페이지 범위를 보정해 큰 페이지에서도 목록이 텅 비지 않는다", async () => {
  available();
  db = { board: { count: async () => 25, findMany: async ({ skip, take }) => { assert.equal(skip, 24); assert.equal(take, 24); return []; } } };
  const result = await queries.getLearningPage(actor, { kind: "pad", page: 999999, pageSize: 999999 });
  assert.equal(result.page, 2);
  assert.equal(result.totalPages, 2);
});

test("교과목 설문 연결은 소유한 설문만 수정하고 다른 교과목 연결을 실수로 해제하지 않는다", async () => {
  const changes = [];
  const teacher = { ...actor, id: "teacher", role: "TEACHER" };
  db = { form: { count: async ({ where }) => { assert.equal(where.ownerId, teacher.id); assert.equal(where.deletedAt, null); return 1; } },
    $transaction: async run => run({ form: { updateMany: async input => { changes.push(input); return { count: 1 }; } } }),
  };
  await queries.applyResourceDelta("course", teacher, "form", { add: ["form"], remove: ["old-form"] });
  assert.deepEqual(changes, [
    { where: { id: { in: ["old-form"] }, ownerId: "teacher", subjectId: "course" }, data: { subjectId: null } },
    { where: { id: { in: ["form"] }, ownerId: "teacher" }, data: { subjectId: "course" } },
  ]);
  db.form.count = async () => 0;
  await assert.rejects(queries.applyResourceDelta("course", teacher, "form", { add: ["other-form"] }), /권한|관리할 수 없는/);
  assert.equal(changes.length, 2);
});
