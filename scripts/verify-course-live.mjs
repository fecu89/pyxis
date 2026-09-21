import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { test } from "node:test";
import { build } from "esbuild";

const require = createRequire(import.meta.url);
const actor = { id: "student", role: "STUDENT", status: "ACTIVE", systemPermissions: [] };
const state = { db: null };
globalThis.courseLiveTest = state;
const bundled = await build({ stdin: { contents: `export * from './lib/learning/queries';`, resolveDir: process.cwd() }, bundle: true, write: false, format: "cjs", platform: "node", packages: "external",
  plugins: [{ name: "db-boundary", setup(b) {
    b.onResolve({ filter: /^(server-only|@\/lib\/prisma|@\/lib\/auth\/authorization)$/ }, args => ({ path: args.path, namespace: "fixture" }));
    b.onLoad({ filter: /.*/, namespace: "fixture" }, ({ path }) => ({ contents: path === "@/lib/prisma" ? "export const getPrisma=()=>globalThis.courseLiveTest.db;"
      : path === "server-only" ? "" : "export class AuthorizationError extends Error{}; export const hasSystemPermission=()=>false;", resolveDir: process.cwd() }));
  } }],
});
const loaded = { exports: {} };
new Function("require", "module", "exports", bundled.outputFiles[0].text)(require, loaded, loaded.exports);
const { getLearningPage } = loaded.exports;
const quiz = { title: "과학 퀴즈", description: null, subject: { id: "science", name: "과학" } };
const session = { id: "live", mode: "LIVE", status: "LOBBY", pinCode: "123456", quiz, participants: [], createdAt: new Date() };
const task = { id: "task", quiz, session: { id: "async", mode: "ASYNC", status: "LOBBY", openAt: null, dueAt: null, allowLateSubmission: false, participants: [{ status: "JOINED", currentQuestionIndex: 0 }] } };
let calls;
function fixture({ live = [session], tasks = [task], waiting = [{ id: "waiting", ...quiz }], history = [], past = [] } = {}) {
  calls = [];
  function model(kind, rowsFor) { return {
    count: async ({ where }) => { calls.push({ kind, where }); return rowsFor(where).length; },
    findMany: async ({ where, select, skip = 0, take }) => {
      assert(take <= 24, "목록은 DB에서 페이지 범위만 읽습니다.");
      assert(!JSON.stringify(select).includes('"questions"'));
      return rowsFor(where).slice(skip, skip + take);
    },
  }; }
  state.db = {
    subject: { findMany: async ({ where }) => { assert.equal(where.OR[0].students.some.studentId, actor.id); return [{ id: "science", ownerId: "teacher" }]; } },
    quizSession: model("session", where => where.status === "FINISHED" ? history : live),
    quizAssignment: model("assignment", where => where.NOT ? past : tasks),
    quiz: model("quiz", () => waiting),
  };
}

test("교과목 라이브는 할당 없이도 나타나고 과제·대기보다 먼저 표시한다", async () => {
  fixture();
  const data = await getLearningPage(actor, { kind: "quiz" });
  assert.deepEqual(data.items.map(item => item.mode), ["LIVE", "ASYNC", "LIVE"]);
  assert.deepEqual(data.items.map(item => item.href), ["/j/123456?subjectId=science", "/p/async", null]);
  assert.equal(data.items[2].status, "수업 대기");
  assert.equal(data.total, 3);
  const live = calls.find(call => call.kind === "session" && typeof call.where.status === "object").where;
  assert.deepEqual(live.OR, [{ hostId: "teacher", quiz: { subjectId: "science" } }]);
  assert.equal(live.quiz.isPublished, true);
  assert.equal(live.quiz.deletedAt, null);
  assert.deepEqual(live.participants.none, { userId: "student", status: "KICKED" });
});

test("라이브·과제가 함께 있어도 페이지 경계에서 중복/누락 없이 전체 개수를 유지한다", async () => {
  fixture();
  const second = await getLearningPage(actor, { kind: "quiz", pageSize: 1, page: 2 });
  assert.equal(second.total, 3);
  assert.equal(second.items[0].href, "/p/async");
  const last = await getLearningPage(actor, { kind: "quiz", pageSize: 1, page: 99 });
  assert.equal(last.page, 3);
  assert.equal(last.items[0].status, "수업 대기");
});

test("참여한 종료 라이브와 완료 과제는 각자의 결과로 연결한다", async () => {
  fixture({ live: [], tasks: [], waiting: [], history: [{ ...session, status: "FINISHED", participants: [{ status: "COMPLETED" }] }], past: [{ ...task, session: { ...task.session, participants: [{ status: "COMPLETED" }] } }] });
  const data = await getLearningPage(actor, { kind: "quiz" });
  assert.deepEqual(data.items.map(item => item.href), ["/quiz/activities/live/report", "/quiz/activities/async/report"]);
  const history = calls.find(call => call.kind === "session" && call.where.status === "FINISHED").where;
  assert.deepEqual(history.participants.some, { userId: "student", status: { not: "KICKED" } });
});
