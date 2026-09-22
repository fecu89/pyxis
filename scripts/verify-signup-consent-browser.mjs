import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import { build } from "esbuild";
const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT_MODULE_PATH || "playwright");
const bundle = await build({ stdin: { contents: `
  import {createRoot} from 'react-dom/client';
  import {AuthForm} from '@/components/auth/auth-form';
  window.signIns=[];
  createRoot(document.getElementById('root')).render(<AuthForm callbackUrl="/dashboard?subjectId=fixture" initialSignupRequired={location.search.includes('signup=required')}/>);
`, resolveDir: process.cwd(), loader: "tsx" }, bundle: true, write: false, jsx: "automatic", format: "iife", define: { "process.env.NODE_ENV": '"production"' },
  plugins: [{ name: "oauth-boundary", setup(b) {
    b.onResolve({ filter: /^next-auth\/react$/ }, () => ({ path: "auth", namespace: "fixture" }));
    b.onLoad({ filter: /.*/, namespace: "fixture" }, () => ({ contents: "export const signIn=async(provider,options)=>{window.signIns.push({provider,options});return {error:'fixture-stop'};};" }));
  } }],
});
const css = (await require("postcss")([require("@tailwindcss/postcss")()]).process(readFileSync("app/globals.css", "utf8"), { from: "app/globals.css" })).css;
const browser = await chromium.launch({ headless: true });
try {
  for (const width of [390, 1280]) {
    const page = await browser.newPage({ viewport: { width, height: 900 } });
    page.setDefaultTimeout(3000);
    const calls = [], errors = [];
    page.on("pageerror", error => errors.push(error.message));
    let rejectConsent = false;
    await page.route("**/*", route => {
      const path = new URL(route.request().url()).pathname;
      if (path === "/fixture") return route.fulfill({ contentType: "text/html; charset=utf-8", body: `<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>${css}</style><main class="auth-page"><section class="auth-page-card"><div id="root"></div></section></main><script>${bundle.outputFiles[0].text}</script>` });
      calls.push({ path, method: route.request().method(), body: route.request().postDataJSON() });
      if (path.endsWith("check-login-id")) return route.fulfill({ json: { available: true } });
      if (path.endsWith("signup-consent")) return route.fulfill({ status: rejectConsent ? 400 : 200, json: rejectConsent ? { error: "동의 저장 실패" } : { ok: true } });
      if (path.endsWith("register")) return route.fulfill({ status: 400, json: { error: "가입 요청 fixture" } });
      throw new Error(`Unexpected request ${path}`);
    });
    await page.goto("http://fixture.local/fixture");
    await page.getByRole("tab", { name: "회원가입", exact: true }).click();
    assert.equal(await page.getByRole("checkbox").count(), 3, "세 동의 항목이 기본 해제 상태로 보여야 합니다.");
    assert.equal(await page.getByRole("checkbox", { checked: true }).count(), 0);
    await page.getByLabel("아이디", { exact: true }).fill("fixtureuser");
    await page.getByRole("button", { name: "아이디 중복 확인" }).click();
    await page.getByLabel("비밀번호", { exact: true }).fill("ClearSky72!");
    await page.getByLabel("비밀번호 확인", { exact: true }).fill("ClearSky72!");
    assert(await page.getByRole("button", { name: "계정 만들기" }).isDisabled());
    await page.locator("#auth-register-panel").evaluate(form => form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })));
    assert.equal(calls.filter(call => call.path.endsWith("register")).length, 0, "버튼을 우회해도 동의 없는 제출을 막습니다.");
    await page.getByRole("button", { name: "개인정보 수집·이용 내용 보기" }).click();
    const dialog = page.getByRole("dialog");
    await dialog.getByRole("heading", { name: "개인정보 처리방침", exact: true }).waitFor();
    assert(await dialog.getByRole("link", { name: "fecu@kakao.com", exact: true }).count());
    await page.keyboard.press("Escape");
    await dialog.waitFor({ state: "detached" });
    for (const checkbox of await page.getByRole("checkbox").all()) await checkbox.check();
    assert(await page.getByRole("button", { name: "계정 만들기" }).isEnabled());
    await page.getByRole("button", { name: "계정 만들기" }).click();
    await page.getByText("가입 요청 fixture", { exact: true }).waitFor();
    assert.deepEqual(calls.find(call => call.path.endsWith("register")).body.consent,
      { terms: true, privacy: true, age14: true, termsVersion: "2026-09-22", privacyVersion: "2026-09-22" });
    rejectConsent = true;
    await page.getByRole("button", { name: "카카오로 계속하기" }).click();
    await page.getByText("동의 저장 실패", { exact: true }).waitFor();
    assert.equal(await page.evaluate(() => window.signIns.length), 0, "동의 저장 실패 시 OAuth로 진행하지 않습니다.");
    rejectConsent = false;
    await page.getByRole("button", { name: "카카오로 계속하기" }).click();
    await page.waitForFunction(() => window.signIns.length === 1);
    assert.equal(calls.filter(call => call.path.endsWith("signup-consent")).length, 2);
    assert.equal(await page.evaluate(() => window.signIns[0].options.callbackUrl), "/dashboard?subjectId=fixture");
    assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
    await page.goto("http://fixture.local/fixture?signup=required");
    assert.equal(await page.getByRole("tab", { name: "회원가입", exact: true }).getAttribute("aria-selected"), "true");
    assert.equal(await page.getByRole("checkbox", { checked: true }).count(), 0);
    await page.getByRole("tab", { name: "로그인", exact: true }).click();
    await page.getByRole("button", { name: "카카오로 계속하기" }).click();
    await page.waitForFunction(() => window.signIns.length === 1);
    assert.equal(calls.at(-1).path, "/api/auth/signup-consent");
    assert.equal(calls.at(-1).method, "DELETE", "로그인만 진행하면 이전 가입 동의는 먼저 지웁니다.");
    assert.deepEqual(errors, []);
    await page.close();
  }
  console.log("PASS: 일반·카카오 동의 UI, 직접 제출 차단, 공용 모달, 실패 처리, 모바일, OAuth 재진입");
} finally { await browser.close(); }
