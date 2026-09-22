import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { build } from "esbuild";

const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT_MODULE_PATH || "playwright");
const school = { id: "school", name: "테스트 학교" };
const classroom = { id: "class", name: "테스트 반", type: "CLASS" };
const department = { id: "department", name: "테스트 부서", type: "DEPARTMENT" };
const schools = [{ ...school, code: null, level: "HIGH", district: null, operatingStatus: "OPERATING", userCount: 2, studentCount: 2, teacherCount: 0, unnumberedStudentCount: 2, unassignedStudentCount: 0, isDefault: false,
  groups: [classroom, department].map(group => ({ ...group, grade: null, classNumber: null, userCount: 0, isDefault: false })) }];
const users = ["학생 하나", "학생 둘"].map((name, index) => ({
  id: `user-${index}`, name, loginIdentifier: `fixture-${index}`, loginType: "LOGIN_ID", role: "STUDENT", status: "ACTIVE", authVersion: 0,
  hasPasswordCredential: true, mustChangePassword: false, studentNumber: null, lastLoginAt: null, createdAt: "2026-01-01T00:00:00.000Z",
  ownedBoardCount: 0, memberBoardCount: 0, systemPermissions: [], school, schoolGroup: classroom, isSchoolRepresentative: false,
}));
const bundle = await build({
  stdin: { contents: `
    import {createRoot} from 'react-dom/client';
    import {AdminUsersPanel} from '@/components/admin/admin-users-panel';
    import {AppDialogProvider} from '@/components/ui/app-dialog';
    createRoot(document.getElementById('root')).render(<AppDialogProvider><AdminUsersPanel
      actor={{id:'actor',name:'관리자',role:'SUPER_ADMIN',systemPermissions:[],school:null,isSchoolRepresentative:false}}
      initialUsers={window.fixtureUsers} initialTotalCount={2} initialPage={1} initialPageSize={10} initialSearchTruncated={false}
      schools={${JSON.stringify(schools)}} initialFilters={{role:'',status:'',query:'',schoolId:'',schoolGroupId:''}}
    /></AppDialogProvider>);`, resolveDir: process.cwd(), loader: "tsx" },
  bundle: true, write: false, jsx: "automatic", format: "iife", define: { "process.env.NODE_ENV": '"production"' },
  plugins: [{ name: "next-dynamic-boundary", setup(builder) {
    // These tests don't open the separately-loaded individual editor or confirmation dialog.
    builder.onResolve({ filter: /^next\/dynamic$/ }, () => ({ path: "dynamic", namespace: "fixture" }));
    builder.onLoad({ filter: /.*/, namespace: "fixture" }, () => ({ contents: "export default () => () => null;" }));
  } }],
});
const browser = await chromium.launch({ headless: true });
const failures = [];
async function scenario(name, run, initialUsers = users) {
  const page = await browser.newPage();
  page.setDefaultTimeout(3000);
  const errors = [];
  page.on("pageerror", error => errors.push(error.message));
  let currentUsers = structuredClone(initialUsers);
  let response = { updated: ["user-0", "user-1"], skipped: [] };
  let refreshCount = 0;
  const requests = [];
  await page.route("**/*", async route => {
    const request = route.request();
    const pathname = new URL(request.url()).pathname;
    if (pathname === "/fixture") return route.fulfill({ contentType: "text/html; charset=utf-8", body: `<meta charset="utf-8"><div id="root"></div><script>window.fixtureUsers=${JSON.stringify(initialUsers)};${bundle.outputFiles[0].text}</script>` });
    if (pathname === "/api/admin/users/bulk") {
      const payload = request.postDataJSON();
      requests.push(payload);
      currentUsers = currentUsers.map(user => response.updated.includes(user.id) ? { ...user, role: payload.role || user.role, status: payload.status || user.status,
        schoolGroup: payload.schoolGroupId ? (payload.schoolGroupId === "department" ? department : classroom) : user.schoolGroup } : user);
      return route.fulfill({ json: response });
    }
    if (pathname === "/api/admin/users") {
      refreshCount++;
      return route.fulfill({ json: { users: currentUsers, totalCount: 2, page: 1, pageSize: 10, searchTruncated: false } });
    }
    throw new Error(`Unexpected boundary: ${pathname}`);
  });
  try {
    await page.goto("http://fixture.local/fixture");
    await page.getByRole("button", { name: "전체선택", exact: true }).click();
    await run({ page, form: page.getByRole("form", { name: "선택 사용자 설정 변경" }), requests,
      setResponse(value) { response = value; }, getRefreshCount: () => refreshCount });
    assert.deepEqual(errors, []);
    console.log(`PASS: ${name}`);
  } catch (error) { failures.push(name); console.error(`FAIL: ${name}: ${error.message}`); }
  finally { await page.close(); }
}
try {
  for (const [targetRole, groupLabel, groupId, initialUsers] of [
    ["TEACHER", "부서 선택", "department", users],
    ["STUDENT", "반 선택", "class", users.map(user => ({ ...user, role: "TEACHER", schoolGroup: department }))],
  ]) await scenario(`역할 ${targetRole}: 소속을 함께 전송하고 성공 후 선택 해제`, async ({ page, form, requests }) => {
    await form.getByLabel("바꿀 역할").selectOption(targetRole);
    await form.getByLabel("학교", { exact: true }).waitFor();
    assert.equal(await form.getByLabel("학교", { exact: true }).count(), 1, "역할 변경에도 학교 선택이 필요합니다.");
    assert.equal(await form.getByRole("button", { name: "변경 적용" }).isDisabled(), true);
    await form.getByLabel("학교", { exact: true }).selectOption("school");
    assert.deepEqual(await form.getByLabel(groupLabel, { exact: true }).locator("option").evaluateAll(options => options.map(option => option.value)), ["", groupId]);
    await form.getByLabel(groupLabel, { exact: true }).selectOption(groupId);
    await form.getByRole("button", { name: "변경 적용" }).click();
    await form.waitFor({ state: "detached" });
    assert.equal(requests.length, 1);
    assert.deepEqual({ role: requests[0].role, schoolId: requests[0].schoolId, schoolGroupId: requests[0].schoolGroupId, userIds: requests[0].userIds },
      { role: targetRole, schoolId: "school", schoolGroupId: groupId, userIds: ["user-0", "user-1"] });
    assert.equal(await page.getByRole("checkbox", { checked: true }).count(), 0);
  }, initialUsers);

  await scenario("역할을 다시 바꾸면 이전 부서를 제출하지 않음", async ({ form }) => {
    await form.getByLabel("바꿀 역할").selectOption("TEACHER");
    await form.getByLabel("학교", { exact: true }).waitFor();
    assert.equal(await form.getByLabel("학교", { exact: true }).count(), 1);
    await form.getByLabel("학교", { exact: true }).selectOption("school");
    await form.getByLabel("부서 선택", { exact: true }).selectOption("department");
    await form.getByLabel("바꿀 역할").selectOption("STUDENT");
    assert.equal(await form.getByLabel("반 선택", { exact: true }).inputValue(), "");
    assert.equal(await form.getByRole("button", { name: "변경 적용" }).isDisabled(), true);
  });

  await scenario("학생 소속 변경은 학교만 선택한 상태에서 제출할 수 없음", async ({ form }) => {
    await form.getByRole("button", { name: "소속", exact: true }).click();
    await form.getByLabel("학교", { exact: true }).selectOption("school");
    assert.equal(await form.getByRole("button", { name: "변경 적용" }).isDisabled(), true);
    await form.getByLabel("반 선택", { exact: true }).selectOption("class");
    assert.equal(await form.getByRole("button", { name: "변경 적용" }).isEnabled(), true);
    await form.getByLabel("학교", { exact: true }).selectOption("");
    assert.equal(await form.getByLabel("반 선택", { exact: true }).inputValue(), "");
    assert.equal(await form.getByRole("button", { name: "변경 적용" }).isDisabled(), true);
  });

  await scenario("관리자 역할 전환은 이전 학교·반 입력을 전송하지 않음", async ({ form, requests }) => {
    await form.getByLabel("학교", { exact: true }).selectOption("school");
    await form.getByLabel("반 선택", { exact: true }).selectOption("class");
    await form.getByLabel("바꿀 역할").selectOption("ADMIN");
    await form.getByRole("button", { name: "변경 적용" }).click();
    await form.waitFor({ state: "detached" });
    assert.equal(requests[0].role, "ADMIN");
    assert.equal("schoolId" in requests[0], false);
    assert.equal("schoolGroupId" in requests[0], false);
  });

  await scenario("전부 실패하면 구체적인 이유와 선택 유지", async ({ page, form, setResponse, getRefreshCount }) => {
    setResponse({ updated: [], skipped: users.map(user => ({ userId: user.id, reason: "역할에 맞는 학교 소속이 아닙니다." })) });
    await form.getByRole("button", { name: "상태", exact: true }).click();
    await form.getByLabel("바꿀 상태").selectOption("SUSPENDED");
    await form.getByRole("button", { name: "변경 적용" }).click();
    await page.getByText(/학생 하나.*역할에 맞는 학교 소속이 아닙니다/).waitFor();
    assert.equal(await page.getByRole("checkbox", { checked: true }).count(), 2);
    assert.equal(await form.count(), 1);
    assert.equal(getRefreshCount(), 0);
  });

  await scenario("부분 성공 후 목록을 갱신해도 실패한 사용자만 선택 유지", async ({ page, form, setResponse, requests }) => {
    setResponse({ updated: ["user-0"], skipped: [{ userId: "user-1", reason: "보유 패드 수가 역할 제한을 초과합니다." }] });
    await form.getByRole("button", { name: "상태", exact: true }).click();
    await form.getByLabel("바꿀 상태").selectOption("SUSPENDED");
    await form.getByRole("button", { name: "변경 적용" }).click();
    await page.locator(".admin-user-card").filter({ hasText: "학생 하나" }).getByText("정지", { exact: true }).waitFor();
    await page.getByText(/학생 둘.*보유 패드 수가 역할 제한을 초과합니다/).waitFor();
    assert.equal(await page.getByRole("checkbox", { name: "학생 하나 선택" }).isChecked(), false);
    assert.equal(await page.getByRole("checkbox", { name: "학생 둘 선택" }).isChecked(), true);
    setResponse({ updated: ["user-1"], skipped: [] });
    await form.getByRole("button", { name: "변경 적용" }).click();
    await form.waitFor({ state: "detached" });
    assert.deepEqual(requests[1].userIds, ["user-1"]);
  });
} finally { await browser.close(); }
assert.deepEqual(failures, [], "모든 관리자 일괄 변경 회귀 테스트가 통과해야 합니다.");
