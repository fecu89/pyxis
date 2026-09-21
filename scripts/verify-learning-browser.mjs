import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { build } from "esbuild";

assert(existsSync("components/learning/course-activities.tsx"), "관리 화면과 분리된 학생 활동 모달이 필요합니다.");
const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT_MODULE_PATH || "playwright");
const result = await build({ stdin: { contents: `
  import {createRoot} from 'react-dom/client';
  import {StudentDashboard} from '@/components/learning/student-dashboard';
  import {ContentCard} from '@/components/ui/content-card';
  const dashboard = await StudentDashboard({user:{id:'student',name:'학생'}});
  createRoot(document.getElementById('root')).render(<>
    <section aria-label="기존 공용 카드"><ContentCard title="기존 목록 카드" href="/reference" description="기존 카드와 비교" badges="패드" metadata="수업" footerLabel="패드" footerAction="열기" menu={{open:false,onOpenChange:()=>{},children:'수정'}} /></section>
    {dashboard}
  </>);
`, loader: "tsx", resolveDir: process.cwd() }, bundle: true, write: false, format: "esm", jsx: "automatic", outfile: "learning-test.js", loader: { ".module.css": "local-css" },
  define: { "process.env.NODE_ENV": '"production"' },
  plugins: [{ name: "next-link", setup(b) {
    b.onResolve({ filter: /^next\/link$/ }, () => ({ path: "link", namespace: "fixture" }));
    b.onResolve({ filter: /^next\/navigation$/ }, () => ({ path: "navigation", namespace: "fixture" }));
    b.onResolve({ filter: /^@\/lib\/learning\/queries$/ }, () => ({ path: "queries", namespace: "fixture" }));
    b.onLoad({ filter: /.*/, namespace: "fixture" }, ({ path }) => ({ contents: path === "link"
      ? "export default function Link({href,children,prefetch,...props}){return <a href={href} {...props}>{children}</a>}"
      : path === "navigation" ? `const router={refresh(){window.learningRefreshes=(window.learningRefreshes||0)+1;}};export const useRouter=()=>router;`
      : `export const getLearningCourses=async()=>[{id:'science',name:'과학',canManage:false}];
         export const getLearningPage=async(user,{kind})=>({kind,total:1,page:1,pageSize:4,totalPages:1,items:[{id:kind,title:'전체현황 '+kind,description:'수업 활동',subjectName:'과학',status:'참여 중',action:'바로 열기',href:({quiz:'/p/session',pad:'/b/board',form:'/s/survey'})[kind]}]});`,
      loader: "tsx", resolveDir: process.cwd() }));
  } }],
});
const css = (await require("postcss")([require("@tailwindcss/postcss")()]).process(readFileSync("app/globals.css", "utf8"), { from: "app/globals.css" })).css;
const browser = await chromium.launch({ headless: true });
try {
  for (const width of [390, 1280]) {
    const page = await browser.newPage({ viewport: { width, height: 850 } });
    const errors = [];
    const requests = [];
    let liveOpen = false;
    page.on("pageerror", e => errors.push(e.message));
    await page.route("**/*", async route => {
      const url = new URL(route.request().url());
      if (url.pathname === "/") return route.fulfill({ contentType: "text/html", body: '<html><head><meta name="viewport" content="width=device-width,initial-scale=1"></head><body><div id="root"></div></body></html>' });
      requests.push(url.pathname);
      assert.equal(url.pathname, "/api/me/learning", "관리용 API를 호출하면 안 된다");
      assert.equal(url.searchParams.get("subjectId"), "science");
      const kind = url.searchParams.get("kind");
      const href = { quiz: liveOpen ? "/j/123456?subjectId=science" : "/p/session", pad: "/b/board", form: "/s/survey" }[kind];
      const items = [{ id: kind, title: `내 ${kind}`, description: "참여 활동", subjectName: "과학", status: "진행 중", action: liveOpen && kind === "quiz" ? "라이브 참여" : "바로 열기", href, ...(kind === "quiz" ? { mode: liveOpen ? "LIVE" : "ASYNC" } : {}) },
        { id: `${kind}-long`, title: "아주긴활동제목".repeat(20), description: "아주긴설명".repeat(30), subjectName: "교과목".repeat(30), status: "마감", action: "바로 열기", href: null }];
      return route.fulfill({ json: { kind, items, total: 2, page: 1, pageSize: 24, totalPages: 1 } });
    });
    await page.clock.install();
    await page.goto("http://fixture.local/");
    await page.addStyleTag({ content: css });
    await page.addStyleTag({ content: result.outputFiles.find(file => file.path.endsWith(".css")).text });
    await page.addScriptTag({ type: "module", content: result.outputFiles.find(file => file.path.endsWith(".js")).text });
    await page.getByRole("heading", { name: "학생님의 수업" }).waitFor();
    assert.equal(await page.locator("main article").count(), 3, "전체현황도 공용 활동 카드를 사용합니다.");
    assert.equal(await page.locator('main button[aria-haspopup="menu"]').count(), 0);
    if (width === 1280) assert(await page.locator("main article").first().evaluate(el => el.getBoundingClientRect().width < 500), "활동이 하나뿐이어도 PC에서 카드가 화면 전체 폭으로 늘어나지 않아야 합니다.");
    if (process.env.LEARNING_SCREENSHOT_DIR) await page.locator("main").screenshot({ path: `${process.env.LEARNING_SCREENSHOT_DIR}/dashboard-${width}.png` });
    const trigger = page.getByRole("button", { name: /과학/ });
    await trigger.click();
    const dialog = page.getByRole("dialog", { name: "과학" });
    await dialog.getByRole("link", { name: /내 quiz/ }).waitFor();
    assert.equal(await dialog.getByRole("link", { name: /내 quiz/ }).getAttribute("href"), "/p/session");
    assert.equal(await dialog.getByRole("link", { name: "바로 열기", exact: true }).getAttribute("href"), "/p/session");
    assert.equal(await dialog.locator("article").count(), 2);
    assert.equal(await dialog.locator("article").nth(1).getByRole("link").count(), 0, "마감 카드에 실행 링크가 생기면 안 됩니다.");
    const reference = await page.getByRole("region", { name: "기존 공용 카드" }).locator("article").evaluate(el => {
      const style = getComputedStyle(el); return { radius: style.borderRadius, background: style.backgroundColor, minHeight: style.minHeight };
    });
    const actual = await dialog.locator("article").first().evaluate(el => {
      const style = getComputedStyle(el); return { radius: style.borderRadius, background: style.backgroundColor, minHeight: style.minHeight };
    });
    assert.deepEqual(actual, reference, "기존 퀴즈·패드 공용 카드의 실제 스타일과 일치해야 합니다.");
    assert.equal(await dialog.locator('button[aria-haspopup="menu"]').count(), 0);
    if (process.env.LEARNING_SCREENSHOT_DIR) await dialog.screenshot({ path: `${process.env.LEARNING_SCREENSHOT_DIR}/course-${width}.png` });
    // 실제 학생 모달을 유지한 채 교사가 방을 연 상황을 재현합니다.
    liveOpen = true;
    await page.evaluate(() => { window.learningRefreshes = 0; });
    await page.clock.fastForward(15001);
    await dialog.getByRole("link", { name: "라이브 참여", exact: true }).waitFor();
    assert.equal(await dialog.getByRole("link", { name: "라이브 참여", exact: true }).getAttribute("href"), "/j/123456?subjectId=science");
    assert.equal(await page.evaluate(() => window.learningRefreshes), 1, "대시보드의 서버 목록도 자동 갱신합니다.");
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
    assert.equal(await dialog.evaluate(el => el.scrollWidth <= el.clientWidth), true, "긴 제목도 모달 내부를 넘치지 않습니다.");
    await page.keyboard.press("Escape");
    await dialog.waitFor({ state: "detached" });
    assert.equal(await trigger.evaluate(el => document.activeElement === el), true);
    assert.equal(requests.length, 4);
    assert.deepEqual(errors, []);
    await page.close();
  }
  console.log("PASS: 전체현황·모달 공용 카드 스타일, 독립 실행 링크, 마감/관리 메뉴 차단, 긴 제목, 모바일, ESC/포커스 복구");
} finally { await browser.close(); }
