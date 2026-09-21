// 실제 질문 유형 선택기와 공유 메뉴를 브라우저에서 구동합니다. 네트워크 요청은 차단합니다.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const root = fileURLToPath(new URL("..", import.meta.url));
const { chromium } = require(process.env.PLAYWRIGHT_MODULE_PATH || "playwright");
const bundle = await require("esbuild").build({
  stdin: { contents: `
    import {createRoot} from 'react-dom/client';
    import {useState} from 'react';
    import {FieldTypePicker} from '@/components/forms/field-type-picker';
    import {ContentCardMenu} from '@/components/ui/content-card-menu';
    function Fixture() {
      const [type,setType]=useState('SHORT_TEXT');
      const [disabled,setDisabled]=useState(false);
      const [tick,setTick]=useState(0);
      window.forceRerender=()=>setTick(current=>current+1);
      window.setPickerDisabled=setDisabled;
      return <main style={{maxWidth:640,margin:'80px auto',padding:16}}>
        <FieldTypePicker value={type} onChange={setType} disabled={disabled}/>
        <input aria-label="질문 제목" defaultValue="입력한 질문"/>
        <button onClick={()=>setTick(tick+1)}>부모 다시 렌더</button>
        <button onClick={()=>setDisabled(!disabled)}>비활성 전환</button>
        <output aria-label="선택 유형">{type}</output>
        <LegacyMenu/>
      </main>;
    }
    function LegacyMenu() {
      const [open,setOpen]=useState(false);
      return <ContentCardMenu title="기존 카드" open={open} onOpenChange={setOpen}>
        <input aria-label="기존 검색"/>
        <button type="button">실행</button>
      </ContentCardMenu>;
    }
    createRoot(document.getElementById('root')).render(<Fixture/>);
  `, loader: "tsx", resolveDir: root },
  absWorkingDir: root, bundle: true, write: false, outdir: "/tmp/pyxis-field-type-picker-bundle", format: "iife", jsx: "automatic",
  define: { "process.env.NODE_ENV": '"production"' },
  plugins: [{ name: "next-link-adapter", setup(builder) {
    builder.onResolve({ filter: /^next\/link$/ }, () => ({ path: "next/link", namespace: "adapter" }));
    builder.onLoad({ filter: /.*/, namespace: "adapter" }, () => ({ contents: "export default function Link({href,children,prefetch,...props}) { return <a {...props} href={href}>{children}</a>; }", loader: "tsx", resolveDir: root }));
  } }],
});
const cssPath = `${root}/app/globals.css`;
const css = (await require("postcss")([require("@tailwindcss/postcss")()]).process(readFileSync(cssPath, "utf8"), { from: cssPath })).css;
const browser = await chromium.launch({ headless: true });
try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  page.setDefaultTimeout(5000);
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.route("**/*", (route) => route.request().url() === "http://fixture.local/"
    ? route.fulfill({ body: '<!doctype html><html lang="ko"><head><meta name="viewport" content="width=device-width,initial-scale=1"></head><body><div id="root"></div></body></html>', contentType: "text/html" })
    : route.abort());
  await page.goto("http://fixture.local/");
  await page.addStyleTag({ content: css });
  for (const file of bundle.outputFiles) {
    if (file.path.endsWith(".css")) await page.addStyleTag({ content: file.text });
    if (file.path.endsWith(".js")) await page.addScriptTag({ content: file.text });
  }
  const trigger = page.getByRole("button", { name: /^질문 유형:/ });
  const panel = page.getByRole("group", { name: "질문 유형 옵션", exact: true });
  await trigger.waitFor();
  assert.equal(await trigger.getAttribute("aria-label"), "질문 유형: 단답형", "보조 기술에 현재 유형 전달");
  assert.equal(await page.locator("select").count(), 0, "기본 select 대신 공유 메뉴 버튼");
  assert.match(await trigger.innerText(), /단답형/);
  await trigger.click();
  assert.equal(await panel.evaluate((element) => element.parentElement.tagName), "BODY", "포털에 표시");
  assert.match(await panel.innerText(), /여러 줄로 답합니다/, "짧은 설명 표시");
  for (const group of ["글", "선택", "척도", "그리드", "기타"]) {
    assert.equal(await panel.getByText(group, { exact: true }).count(), 1, `${group} 그룹 표시`);
  }
  assert.equal(await panel.getByRole("button").count(), 14, "모든 질문 유형 표시");
  assert.equal(await panel.getByRole("button", { name: /단답형/ }).getAttribute("aria-pressed"), "true", "현재 선택 표시");
  await page.evaluate(() => window.forceRerender());
  assert.equal(await panel.count(), 1, "부모 다시 렌더해도 펼침 유지");
  await page.keyboard.press("Escape");
  await trigger.focus();
  await page.keyboard.press("ArrowDown");
  await page.keyboard.press("ArrowDown");
  await page.keyboard.press("Enter");
  assert.equal(await page.getByRole("status", { name: "선택 유형" }).innerText(), "LONG_TEXT", "키보드로 다음 유형 선택");
  assert.equal(await trigger.getAttribute("aria-label"), "질문 유형: 장문형");
  assert.equal(await panel.count(), 0, "선택 후 닫힘");
  await page.waitForFunction(() => document.activeElement?.getAttribute("aria-label") === "질문 유형: 장문형");
  assert.equal(await page.getByRole("textbox", { name: "질문 제목" }).inputValue(), "입력한 질문", "다른 입력 보존");
  await trigger.click();
  await panel.getByRole("button", { name: /파일 업로드/ }).click();
  assert.equal(await page.getByRole("status", { name: "선택 유형" }).innerText(), "FILE_UPLOAD", "포인터로 유형 선택");
  await trigger.click();
  assert.equal(await panel.getByRole("button", { name: /파일 업로드/ }).getAttribute("aria-pressed"), "true", "새 선택 표시");
  assert((await panel.boundingBox()).height <= 482, "데스크톱 메뉴 높이는 480px 안팎");
  assert(await panel.getByRole("button", { name: /파일 업로드/ }).evaluate((item) => {
    const itemRect = item.getBoundingClientRect();
    const panelRect = item.closest('[role="group"]').getBoundingClientRect();
    return itemRect.top >= panelRect.top && itemRect.bottom <= panelRect.bottom;
  }), "재오픈하면 현재 유형이 스크롤 영역 안에 표시됨");
  await page.keyboard.press("Escape");
  await trigger.focus();
  await page.keyboard.press("ArrowDown");
  assert(await panel.getByRole("button", { name: /파일 업로드/ }).evaluate((element) => element === document.activeElement), "키보드로 열 때 현재 유형에 초점");
  await page.keyboard.press("ArrowDown");
  await page.keyboard.press("Enter");
  assert.equal(await page.getByRole("status", { name: "선택 유형" }).innerText(), "SIGNATURE", "현재 유형의 바로 다음 항목 선택");
  for (const [width, theme] of [[1280, "light"], [390, "dark"], [320, "light"]]) {
    await page.setViewportSize({ width, height: 900 });
    await page.evaluate((value) => { document.documentElement.dataset.theme = value; }, theme);
    await trigger.click();
    const box = await panel.boundingBox();
    assert(box.x >= 0 && box.x + box.width <= width + 1 && box.y >= 0 && box.y + box.height <= 901, `${width}px 메뉴 잘림 없음`);
    assert(box.height <= 482, `${width}px 메뉴 높이 제한`);
    assert(await panel.getByRole("button", { name: /서명/ }).evaluate((item) => {
      const itemRect = item.getBoundingClientRect();
      const panelRect = item.closest('[role="group"]').getBoundingClientRect();
      return itemRect.top >= panelRect.top && itemRect.bottom <= panelRect.bottom;
    }), `${width}px 현재 유형 표시`);
    assert(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), `${width}px 가로 넘침 없음`);
    await page.keyboard.press("Escape");
    assert.equal(await panel.count(), 0);
    assert(await trigger.evaluate((element) => element === document.activeElement), "Escape 초점 복귀");
    await trigger.click();
    await page.mouse.click(8, 8);
    assert.equal(await panel.count(), 0, "바깥 클릭 닫힘");
  }
  await trigger.click();
  await page.evaluate(() => window.setPickerDisabled(true));
  assert.equal(await panel.count(), 0, "비활성화 시 열린 메뉴 닫힘");
  assert(await trigger.isDisabled(), "비활성 상태는 열리지 않음");
  await page.evaluate(() => window.setPickerDisabled(false));
  assert.equal(await panel.count(), 0, "다시 활성화해도 옛 메뉴가 자동으로 열리지 않음");
  await page.getByRole("button", { name: "기존 카드 옵션" }).click();
  const legacyInput = page.getByRole("textbox", { name: "기존 검색" });
  await legacyInput.fill("search");
  await legacyInput.press("Home");
  assert(await legacyInput.evaluate((element) => element === document.activeElement), "기존 메뉴 입력의 Home 키를 가로채지 않음");
  assert.equal(await legacyInput.evaluate((element) => element.selectionStart), 0);
  assert.deepEqual(errors, [], "브라우저 오류 없음");
  console.log("PASS: 질문 유형 메뉴의 그룹·설명·선택·키보드·초점·반응형·비활성");
} finally {
  await browser.close();
}
