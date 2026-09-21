import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { build } from "esbuild";

assert(existsSync("components/learning/course-activities.tsx"), "관리 화면과 분리된 학생 활동 모달이 필요합니다.");
const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT_MODULE_PATH || "playwright");
const result = await build({ stdin: { contents: `
  import {createRoot} from 'react-dom/client';
  import {LearningCourses} from '@/components/learning/course-activities';
  createRoot(document.getElementById('root')).render(<LearningCourses courses={[{id:'science',name:'과학',canManage:false}]}/>);
`, loader: "tsx", resolveDir: process.cwd() }, bundle: true, write: false, format: "iife", jsx: "automatic",
  define: { "process.env.NODE_ENV": '"production"' },
  plugins: [{ name: "next-link", setup(b) {
    b.onResolve({ filter: /^next\/link$/ }, () => ({ path: "link", namespace: "fixture" }));
    b.onLoad({ filter: /.*/, namespace: "fixture" }, () => ({ contents: "export default function Link({href,children,prefetch,...props}){return <a href={href} {...props}>{children}</a>}", loader: "tsx", resolveDir: process.cwd() }));
  } }],
});
const css = (await require("postcss")([require("@tailwindcss/postcss")()]).process(readFileSync("app/globals.css", "utf8"), { from: "app/globals.css" })).css;
const browser = await chromium.launch({ headless: true });
try {
  for (const width of [390, 1280]) {
    const page = await browser.newPage({ viewport: { width, height: 850 } });
    const errors = [];
    const requests = [];
    page.on("pageerror", e => errors.push(e.message));
    await page.route("**/*", async route => {
      const url = new URL(route.request().url());
      if (url.pathname === "/") return route.fulfill({ contentType: "text/html", body: '<html><head><meta name="viewport" content="width=device-width,initial-scale=1"></head><body><div id="root"></div></body></html>' });
      requests.push(url.pathname);
      assert.equal(url.pathname, "/api/me/learning", "관리용 API를 호출하면 안 된다");
      assert.equal(url.searchParams.get("subjectId"), "science");
      const kind = url.searchParams.get("kind");
      const href = { quiz: "/p/session", pad: "/b/board", form: "/s/survey" }[kind];
      return route.fulfill({ json: { kind, items: [{ id: kind, title: `내 ${kind}`, description: "참여 활동", subjectName: "과학", status: "진행 중", action: "바로 열기", href }], total: 1, page: 1, pageSize: 24, totalPages: 1 } });
    });
    await page.goto("http://fixture.local/");
    await page.addStyleTag({ content: css });
    await page.addScriptTag({ content: result.outputFiles[0].text });
    const trigger = page.getByRole("button", { name: /과학/ });
    await trigger.click();
    const dialog = page.getByRole("dialog", { name: "과학" });
    await dialog.getByRole("link", { name: /내 quiz/ }).waitFor();
    assert.equal(await dialog.getByRole("link", { name: /내 quiz/ }).getAttribute("href"), "/p/session");
    await dialog.getByRole("button", { name: "패드", exact: true }).click();
    await dialog.getByRole("link", { name: /내 pad/ }).waitFor();
    assert.equal(await dialog.getByRole("link", { name: /내 pad/ }).getAttribute("href"), "/b/board");
    await dialog.getByRole("button", { name: "설문", exact: true }).click();
    await dialog.getByRole("link", { name: /내 form/ }).waitFor();
    assert.equal(await dialog.getByRole("link", { name: /내 form/ }).getAttribute("href"), "/s/survey");
    assert.equal(await dialog.getByRole("checkbox").count(), 0);
    assert.equal(await dialog.getByText("학생 배정", { exact: true }).count(), 0);
    assert(await dialog.evaluate(el => el.getBoundingClientRect().right <= window.innerWidth));
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), true);
    await page.keyboard.press("Escape");
    await dialog.waitFor({ state: "detached" });
    assert.equal(await trigger.evaluate(el => document.activeElement === el), true);
    assert.equal(requests.length, 3);
    assert.deepEqual(errors, []);
    await page.close();
  }
  console.log("PASS: 학생 공용 모달 퀴즈·패드·설문 이동, 관리 API 미호출, 모바일, ESC/포커스 복구");
} finally { await browser.close(); }
