// 실제 Server Component와 GET을 실행합니다. 인증 저장소/DB만 fixture로 대체합니다.
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { test } from "node:test";
import { build } from "esbuild";

const require = createRequire(import.meta.url);
const state = { actor: { id: "student", role: "STUDENT", status: "ACTIVE", systemPermissions: [] }, managerLoads: 0, member: true, db: null };
globalThis.learningRouteTest = state;
const result = await build({ stdin: { contents: `
  export {default as CoursePage} from './app/(workspace)/courses/[subjectId]/page';
  export {default as CoursesPage} from './app/(workspace)/courses/page';
  export {renderQuizLibraryPage as QuizPage} from './app/(workspace)/quiz/(library)/quiz-library-page';
  export {renderFormListPage as FormPage} from './app/(workspace)/forms/(library)/form-list-page';
  export {default as FormLayout} from './app/(workspace)/forms/(library)/layout';
  export {GET as LearningAPI} from './app/api/me/learning/route';
  export {GET as CandidatesAPI} from './app/api/subjects/[subjectId]/candidates/route';
  export {POST as ResourcesAPI} from './app/api/subjects/[subjectId]/resources/route';
  export {GET as RosterAPI} from './app/api/subjects/[subjectId]/roster/route';
  export {getFormAccess} from './lib/forms/access';
`, resolveDir: process.cwd() }, bundle: true, write: false, platform: "node", format: "cjs", packages: "external",
  plugins: [{ name: "route-boundaries", setup(b) {
    b.onResolve({ filter: /^server-only$/ }, () => ({ path: "empty", namespace: "fixture" }));
    b.onResolve({ filter: /^@\/lib\/prisma$/ }, () => ({ path: "db", namespace: "fixture" }));
    b.onResolve({ filter: /^@\/lib\/auth\/(current-user|authorization)$/ }, args => ({ path: args.path.endsWith("current-user") ? "user" : "auth", namespace: "fixture" }));
    b.onResolve({ filter: /^next\/navigation$/ }, () => ({ path: "navigation", namespace: "fixture" }));
    b.onResolve({ filter: /^@\/components\/(courses\/(course-detail|course-list)|quiz\/quiz-library|forms\/form-list)$/ }, args => ({ path: args.path.split("/").at(-1), namespace: "manager" }));
    b.onLoad({ filter: /.*/, namespace: "manager" }, ({ path }) => {
      const name = { "course-detail": "CourseDetail", "course-list": "CourseList", "quiz-library": "QuizLibrary", "form-list": "FormList" }[path];
      return { contents: `globalThis.learningRouteTest.managerLoads++; export function ${name}(){return null;}` };
    });
    b.onLoad({ filter: /.*/, namespace: "fixture" }, ({ path }) => ({ contents: {
      db: "export const getPrisma = () => globalThis.learningRouteTest.db;",
      user: "export class AuthenticationError extends Error {}; export const getCurrentUser = async () => globalThis.learningRouteTest.actor;",
      auth: "import {AuthenticationError} from '@/lib/auth/current-user'; export class AuthorizationError extends Error {}; export const hasSystemPermission=()=>false; export const canViewAllQuizzes=()=>false; export const requireActiveUser=async()=>{const user=globalThis.learningRouteTest.actor;if(!user) throw new AuthenticationError('로그인이 필요합니다.');return user;};",
      navigation: "export const useRouter=()=>({refresh(){}}); export const notFound=()=>{throw new Error('NOT_FOUND')}; export const redirect=path=>{throw new Error('REDIRECT:'+path)};",
      empty: "",
    }[path] }));
    // 클라이언트 스타일은 이 서버 실행 검증 범위 밖입니다. 모달 브라우저 검증에서 실제 CSS를 씁니다.
    b.onLoad({ filter: /\.css$/ }, () => ({ contents: "export default {};", loader: "js" }));
  } }],
});
const loadedModule = { exports: {} };
new Function("require", "module", "exports", result.outputFiles[0].text)(require, loadedModule, loadedModule.exports);
const routes = loadedModule.exports;
state.db = {
  subject: {
    findUnique: async ({ select }) => { if (select) { assert.equal(select.ownerId, true); assert.equal(select._count, undefined); } return { id: "course", name: "과학", ownerId: "teacher" }; },
    findMany: async ({ select }) => { assert.equal(select.students, undefined); return [{ id: "course", name: "과학", ownerId: "teacher" }]; },
  },
  user: { count: async () => Number(state.member), findMany: async () => { throw new Error("학생 화면에서 명단을 읽었습니다."); } },
  quizAssignment: { count: async () => 0, findMany: async () => [] },
  quizSession: { count: async () => 0, findMany: async () => [] },
  quiz: { count: async () => 0, findMany: async () => [] },
  form: { count: async () => 0, findMany: async () => [] },
};

test("학생의 교과목 상세/목록은 관리 컴포넌트를 로드하거나 명단을 조회하지 않는다", async () => {
  await routes.CoursePage({ params: Promise.resolve({ subjectId: "course" }) });
  await routes.CoursesPage();
  assert.equal(state.managerLoads, 0);
});
test("수강생이 아닌 직접 URL 접근은 학생 모달 렌더링 전에 거절한다", async () => {
  state.member = false;
  try { await assert.rejects(routes.CoursePage({ params: Promise.resolve({ subjectId: "other" }) }), /NOT_FOUND/); }
  finally { state.member = true; }
});
test("학생 퀴즈/설문 진입은 관리 보관함 대신 학습 컴포넌트를 반환한다", async () => {
  const quiz = await routes.QuizPage(Promise.resolve({}), { tab: "mine", view: "ALL" });
  const form = await routes.FormPage(Promise.resolve({}), "ALL");
  assert.equal(quiz.props.kind, "quiz");
  assert.equal(form.props.kind, "form");
  assert.equal(state.managerLoads, 0);
  const child = { marker: "learner" };
  assert.equal((await routes.FormLayout({ children: child })).props.children, child);
});
test("학습 API는 서버에서 교과목 접근과 파라미터를 확인하고 캐시하지 않는다", async () => {
  const good = await routes.LearningAPI(new Request("http://localhost/api/me/learning?kind=quiz&subjectId=course"));
  assert.equal(good.status, 200);
  assert.equal(good.headers.get("cache-control"), "private, no-store");
  assert.deepEqual((await good.json()).items, []);
  state.member = false;
  try {
    assert.equal((await routes.LearningAPI(new Request("http://localhost/api/me/learning?kind=form&subjectId=other"))).status, 403);
  } finally { state.member = true; }
  assert.equal((await routes.LearningAPI(new Request("http://localhost/api/me/learning?kind=admin"))).status, 400);
  assert.equal((await routes.LearningAPI(new Request("http://localhost/api/me/learning?kind=quiz&page=-1"))).status, 400);
});

test("학생이 관리용 후보 조회와 설문 연결 API를 직접 호출해도 차단한다", async () => {
  const params = { params: Promise.resolve({ subjectId: "course" }) };
  assert.equal((await routes.CandidatesAPI(new Request("http://localhost/api/subjects/course/candidates?type=form"), params)).status, 403);
  assert.equal((await routes.ResourcesAPI(new Request("http://localhost/api/subjects/course/resources", {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ forms: { add: ["form"] } }),
  }), params)).status, 403);
});
test("비로그인 학습 API는 인증 오류로 종료한다", async () => {
  const actor = state.actor;
  state.actor = null;
  try { assert.equal((await routes.LearningAPI(new Request("http://localhost/api/me/learning?kind=form"))).status, 401); }
  finally { state.actor = actor; }
});

test("학생 소유 교과목도 관리 화면·명단·후보 API를 열지 않는다", async () => {
  const findUnique = state.db.subject.findUnique;
  state.db.subject.findUnique = async () => ({ id: "course", name: "내 과목", ownerId: state.actor.id });
  try {
    await routes.CoursePage({ params: Promise.resolve({ subjectId: "course" }) });
    assert.equal(state.managerLoads, 0);
    const params = { params: Promise.resolve({ subjectId: "course" }) };
    assert.equal((await routes.RosterAPI(new Request("http://localhost/api/subjects/course/roster"), params)).status, 403);
    assert.equal((await routes.CandidatesAPI(new Request("http://localhost/api/subjects/course/candidates?type=form"), params)).status, 403);
    assert.equal((await routes.ResourcesAPI(new Request("http://localhost/api/subjects/course/resources", {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ forms: { add: ["form"] } }),
    }), params)).status, 403);
  } finally { state.db.subject.findUnique = findUnique; }
});
test("학생에게 설문 관리 데이터와 교과목 명단을 조회하지 않는다", async () => {
  assert.equal(await routes.getFormAccess("old-owned-form", state.actor), null);
  assert.equal((await routes.RosterAPI(new Request("http://localhost/api/subjects/course/roster"), { params: Promise.resolve({ subjectId: "course" }) })).status, 403);
});
