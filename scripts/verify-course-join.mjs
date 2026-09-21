import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { test } from "node:test";
import { build } from "esbuild";

const require = createRequire(import.meta.url);
const state = { actor: { id: "student", name: "학생", role: "STUDENT", status: "ACTIVE" }, member: true, writes: 0, kicked: false, db: null, session: null };
globalThis.courseJoinTest = state;
const bundled = await build({ stdin: { contents: `
  export {POST as join} from './app/api/quiz/sessions/join/route';
  export {POST as publicJoin} from './app/api/public/sessions/join/route';
`, resolveDir: process.cwd() }, bundle: true, write: false, format: "cjs", platform: "node", packages: "external",
  plugins: [{ name: "external-boundaries", setup(b) {
    b.onResolve({ filter: /^(server-only|@\/lib\/prisma|@\/lib\/auth\/(authorization|current-user)|@\/lib\/security\/(rate-limit|public-quiz-rate-limit))$/ }, args => ({ path: args.path, namespace: "fixture" }));
    b.onLoad({ filter: /.*/, namespace: "fixture" }, ({ path }) => ({ contents: path === "@/lib/prisma" ? "export const getPrisma=()=>globalThis.courseJoinTest.db;"
      : path.endsWith("authorization") ? "export class AuthorizationError extends Error{}; export const hasSystemPermission=()=>false; export const requireRole=async roles=>{const actor=globalThis.courseJoinTest.actor;if(!actor||!roles.includes(actor.role)) throw new AuthorizationError();return actor;};"
      : path.endsWith("current-user") ? "export class AuthenticationError extends Error{}; export const getCurrentUser=async()=>globalThis.courseJoinTest.actor;"
      : path.includes("rate-limit") ? "export class RateLimitError extends Error{};export const assertRateLimit=()=>{};export const assertPublicQuizJoinRateLimit=async()=>{};export const assertPublicQuizInvalidPinRateLimit=()=>{};" : "", resolveDir: process.cwd() }));
  } }],
});
const loaded = { exports: {} };
new Function("require", "module", "exports", bundled.outputFiles[0].text)(require, loaded, loaded.exports);
function reset(publicAccess = false) {
  state.actor = { id: "student", name: "학생", role: "STUDENT", status: "ACTIVE" };
  state.member = true; state.writes = 0; state.kicked = false;
  state.session = { id: "live", mode: "LIVE", status: "LOBBY", hostId: "teacher", requiresLogin: !publicAccess,
    quiz: { deletedAt: null, isPublished: true, subjectId: "science" } };
  state.db = {
    quizSession: { findUnique: async () => state.session },
    subject: { count: async ({ where }) => {
      assert.equal(where.id, "science"); assert.equal(where.ownerId, "teacher");
      assert.equal(where.OR[0].students.some.studentId, "student");
      return Number(state.member);
    } },
    sessionParticipant: {
      findUnique: async () => state.kicked ? { status: "KICKED" } : null,
      findFirst: async () => null,
      upsert: async () => { state.writes++; return { id: "participant", nickname: "학생" }; },
      create: async () => { state.writes++; return { id: "participant", nickname: "학생" }; },
    },
  };
}
async function join(publicAccess = false, withCourse = true) {
  return loaded.exports[publicAccess ? "publicJoin" : "join"](new Request("http://localhost/api/quiz/sessions/join", {
    method: "POST", headers: { "Content-Type": "application/json", Origin: "http://localhost" },
    body: JSON.stringify({ pin: "123456", nickname: "학생", ...(withCourse ? { subjectId: "science" } : {}) }),
  }));
}
for (const publicAccess of [false, true]) {
  test(`${publicAccess ? "공개" : "로그인"} 라이브의 교과목 진입은 수강생만 허용한다`, async () => {
    reset(publicAccess); state.member = false;
    assert.equal((await join(publicAccess)).status, 403);
    assert.equal(state.writes, 0);
    state.member = true;
    assert.equal((await join(publicAccess)).status, 200);
    assert.equal(state.writes, 1);
  });
  test(`${publicAccess ? "공개" : "로그인"} 교과목 진입으로 다른 과목·초안·자율 풀이에 우회 입장할 수 없다`, async () => {
    for (const mutation of [s => { s.quiz.subjectId = "other"; }, s => { s.quiz.isPublished = false; }, s => { s.mode = "ASYNC"; }]) {
      reset(publicAccess); mutation(state.session);
      assert.equal((await join(publicAccess)).status, 403);
      assert.equal(state.writes, 0);
    }
  });
  test(`${publicAccess ? "공개" : "로그인"} 기존 PIN 참여는 교과목을 지정하지 않아도 유지된다`, async () => {
    reset(publicAccess); state.member = false;
    assert.equal((await join(publicAccess, false)).status, 200);
  });
  test(`${publicAccess ? "공개" : "로그인"} 종료/삭제된 교과목 라이브는 참여자를 만들지 않는다`, async () => {
    for (const mutation of [s => { s.status = "FINISHED"; }, s => { s.status = "CANCELLED"; }, s => { s.quiz.deletedAt = new Date(); }]) {
      reset(publicAccess); mutation(state.session);
      assert.equal((await join(publicAccess)).status, 403);
      assert.equal(state.writes, 0);
    }
  });
}

test("학생이 아닌 공개 교과목 접근과 로그인 강퇴 참여자는 다시 등록하지 않는다", async () => {
  for (const actor of [null, { id: "student", role: "TEACHER", status: "ACTIVE" }, { id: "student", role: "STUDENT", status: "SUSPENDED" }]) {
    reset(true); state.actor = actor;
    assert.equal((await join(true)).status, 403);
    assert.equal(state.writes, 0);
  }
  reset(); state.kicked = true;
  assert.notEqual((await join()).status, 200);
  assert.equal(state.writes, 0);
});
