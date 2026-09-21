import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { build } from "esbuild";

const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT_MODULE_PATH || "playwright");
const bundle = await build({ stdin: { contents: `
  import {createRoot} from 'react-dom/client';
  import {QuizSessionDialog} from '@/components/quiz/quiz-session-dialog';
  import {JoinSessionCard} from '@/components/quiz/join-session-card';
  const root=createRoot(document.getElementById('root'));
  window.showTeacher=()=>root.render(<QuizSessionDialog quizId="quiz" quizTitle="과학" requiresLogin publishedHere={false} onClose={()=>root.render(null)} onAssign={()=>root.render(<p>학생 선택으로 이동</p>)} />);
  window.showStudent=()=>root.render(<JoinSessionCard pin="123456" quizTitle="과학" mode="LIVE" requiresLogin initialNickname="학생" canJoin resume={false} autoJoin subjectId="science" />);
  window.showTeacher();
`, loader: "tsx", resolveDir: process.cwd() }, bundle: true, write: false, format: "iife", jsx: "automatic",
  define: { "process.env.NODE_ENV": '"production"' }, plugins: [{ name: "router-boundary", setup(b) {
    b.onResolve({ filter: /^next\/navigation$/ }, () => ({ path: "router", namespace: "fixture" }));
    b.onResolve({ filter: /^next\/link$/ }, () => ({ path: "link", namespace: "fixture" }));
    b.onLoad({ filter: /.*/, namespace: "fixture" }, ({ path }) => ({ contents: path === "router"
      ? "const router={push:path=>window.navigated=path,replace:path=>window.navigated=path};export const useRouter=()=>router;"
      : "export default function Link({href,children,...props}){return <a href={href} {...props}>{children}</a>}", loader: "tsx", resolveDir: process.cwd() }));
  } }],
});
const css = (await require("postcss")([require("@tailwindcss/postcss")()]).process(readFileSync("app/globals.css", "utf8"), { from: "app/globals.css" })).css;
const browser = await chromium.launch({ headless: true });
let release;
try {
  const page = await browser.newPage({ viewport: { width: 390, height: 850 } });
  const errors = [];
  const requests = [];
  page.on("pageerror", error => errors.push(error.message));
  await page.route("**/*", async route => {
    const path = new URL(route.request().url()).pathname;
    if (path === "/") return route.fulfill({ contentType: "text/html", body: '<html><body><div id="root"></div></body></html>' });
    const body = route.request().postDataJSON(); requests.push({ path, body });
    if (path === "/api/quiz/sessions") {
      assert.deepEqual(body, { quizId: "quiz", mode: "LIVE" });
      await new Promise(resolve => { release = resolve; });
      return route.fulfill({ json: { session: { id: "live" } } });
    }
    assert.equal(path, "/api/quiz/sessions/join");
    assert.deepEqual(body, { pin: "123456", subjectId: "science" });
    return route.fulfill({ json: { sessionId: "live" } });
  });
  await page.goto("http://fixture.local/");
  await page.addStyleTag({ content: css });
  await page.addScriptTag({ content: bundle.outputFiles[0].text });
  await page.getByRole("button", { name: "자율 풀이 과제 할당" }).click();
  await page.getByText("학생 선택으로 이동").waitFor();
  assert.equal(requests.length, 0, "과제 선택만으로 미할당 링크 세션을 생성하면 안 됩니다.");
  await page.evaluate(() => window.showTeacher());
  await page.getByRole("button", { name: "세션 열기", exact: true }).click();
  await page.getByRole("button", { name: "여는 중...", exact: true }).waitFor();
  assert.equal(await page.getByRole("button", { name: "자율 풀이 과제 할당" }).isDisabled(), true);
  release();
  await page.waitForFunction(() => window.navigated === "/quiz/host/live");
  await page.evaluate(() => window.showStudent());
  await page.waitForFunction(() => window.navigated === "/p/live");
  assert.deepEqual(requests.map(request => request.path), ["/api/quiz/sessions", "/api/quiz/sessions/join"]);
  assert.deepEqual(errors, []);
  console.log("PASS: 교사 라이브/과제 진입 분리, 생성 중 중복 동작 차단, 학생 PIN 없이 교과목 라이브 입장");
} finally { release?.(); await browser.close(); }
