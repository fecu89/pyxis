// 실제 AuthForm과 전역 CSS를 Chromium에서 검증합니다. 인증 API는 메모리 fixture로만 처리합니다.
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
    import {AuthForm} from '@/components/auth/auth-form';
    import {useDebouncedSearch} from '@/lib/use-debounced-search';
    const root=createRoot(document.getElementById('root'));let sequence=0;
    window.calls=[];window.holdRegistration=false;
    window.fetch=async(url,init)=>{
      window.calls.push({url,body:JSON.parse(init.body)});
      const json=(body,status=200)=>new Response(JSON.stringify(body),{status,headers:{'content-type':'application/json'}});
      if(url==='/api/auth/register/check-login-id')return json({available:true});
      if(url==='/api/auth/register'){
        if(window.holdRegistration)await new Promise(resolve=>window.releaseRegistration=resolve);
        return json({error:'서버에서 가입을 거절했습니다.'},400);
      }
      throw Error('Unexpected request: '+url);
    };
    window.render=(modal=false)=>root.render(modal
      ? <div className="modal-backdrop"><section className="modal-panel auth-modal" role="dialog"><AuthForm key={++sequence}/></section></div>
      : <main className="auth-page"><section className="auth-page-card"><AuthForm key={++sequence}/></section></main>);
    window.searches=[];
    function SearchFixture(){
      const [value,setValue]=useState('');const [committed,setCommitted]=useState('');const [sort,setSort]=useState('recent');
      useDebouncedSearch({value,committedValue:committed,minimumLength:2,onSearch:next=>{window.searches.push({value:next,sort});setCommitted(next)}});
      return <div><label>검색<input value={value} onChange={e=>setValue(e.target.value)}/></label><label>확정 검색어<input value={committed} onChange={e=>setCommitted(e.target.value)}/></label><label>정렬<input value={sort} onChange={e=>setSort(e.target.value)}/></label></div>;
    }
    window.renderSearch=()=>root.render(<SearchFixture/>);
  `, loader: "tsx", resolveDir: root },
  absWorkingDir: root, bundle: true, write: false, format: "iife", jsx: "automatic",
  define: { "process.env.NODE_ENV": '"production"' },
  plugins: [{ name: "auth-adapter", setup(builder) {
    builder.onResolve({ filter: /^next-auth\/react$/ }, () => ({ path: "next-auth/react", namespace: "adapter" }));
    builder.onLoad({ filter: /.*/, namespace: "adapter" }, () => ({ contents: "export const signIn=async()=>({ok:false,error:'fixture'});" }));
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
  await page.addScriptTag({ content: bundle.outputFiles[0].text });
  await page.clock.install();
  await page.clock.pauseAt(new Date());
  const form = page.locator("#auth-register-panel");
  const password = form.getByLabel("비밀번호", { exact: true });
  const confirmation = form.getByLabel("비밀번호 확인", { exact: true });
  const submit = form.getByRole("button", { name: "계정 만들기", exact: true });
  const mismatch = "비밀번호 확인이 일치하지 않습니다.";
  const match = "비밀번호가 일치합니다.";
  const strongPassword = "ClearSky7!"; // 정확히 최소 길이인 10자
  const otherPassword = "QuietSea8!";
  const statusText = async () => (await form.getByRole("status").allTextContents()).join("");
  const registrationCount = () => page.evaluate(() => window.calls.filter((call) => call.url === "/api/auth/register").length);
  async function enterRegistration(modal = false) {
    await page.evaluate((modal) => window.render(modal), modal);
    await page.getByRole("tab", { name: "회원가입", exact: true }).click();
    await form.getByLabel("아이디", { exact: true }).fill("newmember");
    await form.getByRole("button", { name: "아이디 중복 확인", exact: true }).click();
    await password.waitFor();
  }

  for (const [width, modal, theme] of [[1280, false, "light"], [390, false, "dark"], [320, true, "light"]]) {
    await page.setViewportSize({ width, height: 900 });
    await page.evaluate((theme) => { document.documentElement.dataset.theme = theme; }, theme);
    await enterRegistration(modal);
    assert.equal(await statusText(), "", "처음부터 불일치 경고를 표시하지 않음");
    await password.fill(strongPassword);
    await confirmation.fill("123456789");
    await page.clock.runFor(600);
    assert.equal(await statusText(), "", "확인이 9자면 입력이 멈춰도 검사하지 않음");
    await confirmation.fill(otherPassword);
    await page.clock.runFor(199);
    assert.equal(await statusText(), "", "10자부터 200ms 대기");
    await page.clock.runFor(1);
    assert.equal(await statusText(), mismatch, "10자 이상이며 입력이 200ms 멈추면 불일치 표시");
    assert.equal(await confirmation.getAttribute("aria-invalid"), "true");
    assert(await submit.isDisabled(), "불일치 상태에서는 가입 불가");

    await confirmation.fill(`${otherPassword}x`);
    assert.equal(await statusText(), "", "다시 입력하면 이전 결과 즉시 제거");
    await page.clock.runFor(150);
    await confirmation.fill(strongPassword);
    await page.clock.runFor(50);
    assert.equal(await statusText(), "", "이전 입력의 타이머 취소");
    await page.clock.runFor(150);
    assert.equal(await statusText(), match);
    assert.equal(await confirmation.getAttribute("aria-invalid"), "false");
    assert(await submit.isEnabled());
    assert.equal(await form.getByRole("alert").count(), 0, "수정한 뒤 오래된 오류가 남지 않음");

    await password.fill(otherPassword);
    assert.equal(await statusText(), "");
    assert(await submit.isDisabled(), "검사 대기 중에도 불일치 제출 차단");
    await page.clock.runFor(200);
    assert.equal(await statusText(), mismatch, "첫 번째 비밀번호 변경도 다시 검사");
    await password.fill("123456789");
    await page.clock.runFor(600);
    assert.equal(await statusText(), "", "첫 비밀번호도 최소 길이 미만이면 검사하지 않음");
    assert(await submit.isDisabled());
    await password.fill(`${strongPassword} `);
    await page.clock.runFor(200);
    assert.equal(await statusText(), mismatch, "검색 타이머를 재사용해도 비밀번호 공백은 제거하지 않음");
    await confirmation.fill(`${strongPassword} `);
    await page.clock.runFor(200);
    assert.equal(await statusText(), match, "공백까지 정확히 같을 때만 일치");
    await password.fill(strongPassword);
    await confirmation.fill("");
    await page.clock.runFor(600);
    assert.equal(await statusText(), "", "확인 입력을 지우면 결과 제거");
    assert(await submit.isDisabled());
    await confirmation.fill(strongPassword);
    await page.clock.runFor(200);

    const beforeToggle = await registrationCount();
    for (const [field, name, other] of [[password, "비밀번호", confirmation], [confirmation, "비밀번호 확인", password]]) {
      const show = form.getByRole("button", { name: `${name} 보기`, exact: true });
      assert.equal(await field.getAttribute("type"), "password");
      assert.equal(await show.getAttribute("aria-controls"), await field.getAttribute("id"));
      await show.focus();
      await page.keyboard.press("Space");
      const hide = form.getByRole("button", { name: `${name} 숨기기`, exact: true });
      assert.equal(await field.getAttribute("type"), "text");
      assert.equal(await other.getAttribute("type"), "password", "각 보기 버튼은 독립 동작");
      assert.equal(await hide.getAttribute("aria-pressed"), "true");
      assert.equal(await field.inputValue(), strongPassword);
      const fieldBox = await field.boundingBox();
      const toggleBox = await hide.boundingBox();
      assert(toggleBox.width >= 44 && toggleBox.height >= 44, "모바일 터치 영역 확보");
      assert(toggleBox.x >= fieldBox.x && toggleBox.x + toggleBox.width <= fieldBox.x + fieldBox.width + 1, "버튼이 입력칸을 벗어나지 않음");
      await page.keyboard.press("Enter");
      assert.equal(await field.getAttribute("type"), "password");
      assert.equal(await field.inputValue(), strongPassword);
    }
    assert.equal(await registrationCount(), beforeToggle, "보기 버튼은 가입 요청하지 않음");
    assert(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), "가로 넘침 없음");

    await page.evaluate(() => { window.holdRegistration = true; });
    await submit.click();
    await form.getByRole("button", { name: "계정 만드는 중…", exact: true }).waitFor();
    assert(await password.isDisabled());
    assert(await confirmation.isDisabled());
    assert(await form.getByRole("button", { name: "비밀번호 보기", exact: true }).isDisabled());
    assert(await form.getByRole("button", { name: "비밀번호 확인 보기", exact: true }).isDisabled());
    await page.evaluate(() => { window.holdRegistration = false; window.releaseRegistration(); });
    await form.getByRole("alert").waitFor();
    assert.equal(await form.getByRole("alert").innerText(), "서버에서 가입을 거절했습니다.");
    await confirmation.fill(otherPassword);
    assert.equal(await form.getByRole("alert").count(), 0, "새 입력 시 이전 제출 오류 제거");
    await page.clock.runFor(200);
    assert.equal(await statusText(), mismatch);
    const beforeInvalidSubmit = await registrationCount();
    await form.evaluate((element) => element.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })));
    assert.equal(await registrationCount(), beforeInvalidSubmit, "버튼을 우회해도 제출 시 불일치 검사 유지");
    await confirmation.fill(strongPassword);
    assert.equal(await form.getByRole("alert").count(), 0);
    await page.clock.runFor(200);
    assert.equal(await statusText(), match);

    await form.getByRole("button", { name: "비밀번호 보기", exact: true }).click();
    await form.getByRole("button", { name: "비밀번호 확인 보기", exact: true }).click();
    await form.getByRole("button", { name: "변경", exact: true }).click();
    await form.getByRole("button", { name: "아이디 중복 확인", exact: true }).click();
    await password.waitFor();
    assert.equal(await password.getAttribute("type"), "password");
    assert.equal(await confirmation.getAttribute("type"), "password");
    assert.equal(await password.inputValue(), "");
    assert.equal(await statusText(), "");
    assert(await submit.isDisabled());
    await password.fill(strongPassword);
    await confirmation.fill(otherPassword);
    await form.getByRole("button", { name: "비밀번호 보기", exact: true }).click();
    await form.getByRole("button", { name: "비밀번호 확인 보기", exact: true }).click();
    await page.clock.runFor(150);
    await page.getByRole("tab", { name: "로그인", exact: true }).click();
    await page.clock.runFor(200);
    await page.getByRole("tab", { name: "회원가입", exact: true }).click();
    await form.getByRole("button", { name: "아이디 중복 확인", exact: true }).click();
    await password.waitFor();
    assert.equal(await statusText(), "", "화면을 떠날 때 예약된 검사 취소");
    assert.equal(await password.inputValue(), "", "회원가입 재진입 시 비밀번호 초기화");
    assert.equal(await confirmation.inputValue(), "");
    assert.equal(await password.getAttribute("type"), "password", "회원가입 재진입 시 보기 상태 초기화");
    assert.equal(await confirmation.getAttribute("type"), "password");
    console.log(`PASS: ${width}px / ${modal ? "modal" : "page"} / ${theme}: 지연 검사·길이 경계·보기 버튼·제출 방어`);
  }

  // 검색 훅에서 추출한 공통 타이머를 써도 검색의 기존 정규화·지연·최신 콜백은 보존합니다.
  await page.evaluate(() => window.renderSearch());
  const search = page.getByLabel("검색", { exact: true });
  const searches = () => page.evaluate(() => window.searches);
  await search.fill("a");
  await page.clock.runFor(400);
  assert.deepEqual(await searches(), [], "검색은 기존 최소 길이 미만이면 요청하지 않음");
  await search.fill("  pad  ");
  await page.clock.runFor(349);
  assert.deepEqual(await searches(), [], "기존 검색은 350ms 지연 유지");
  await page.clock.runFor(1);
  assert.deepEqual(await searches(), [{ value: "pad", sort: "recent" }], "검색만 공백 정규화");
  await search.fill("forms");
  await page.clock.runFor(200);
  await search.fill("quiz");
  await page.clock.runFor(200);
  await page.getByLabel("정렬", { exact: true }).fill("title");
  await page.clock.runFor(149);
  assert.equal((await searches()).length, 1, "계속 입력하는 동안 검색 미실행");
  await page.clock.runFor(1);
  assert.deepEqual((await searches()).at(-1), { value: "quiz", sort: "title" }, "재입력 타이머 취소와 최신 콜백 유지");
  await search.fill("manual");
  await page.clock.runFor(150);
  await page.getByLabel("확정 검색어", { exact: true }).fill("manual");
  await page.clock.runFor(400);
  assert.equal((await searches()).length, 2, "외부에서 이미 확정된 검색은 중복 요청하지 않음");
  await search.fill("");
  await page.clock.runFor(350);
  assert.deepEqual((await searches()).at(-1), { value: "", sort: "title" }, "검색을 지우면 전체 목록 복원");
  await search.fill("unmount");
  await page.clock.runFor(150);
  await page.evaluate(() => window.render());
  await page.clock.runFor(400);
  assert.equal((await searches()).length, 3, "화면을 떠나면 검색 타이머 취소");
  console.log("PASS: 공용 검색 훅의 350ms·정규화·재입력 취소·최신 콜백·화면 전환 회귀 검사");
  assert.deepEqual(errors, [], "브라우저 실행 오류 없음");
} finally {
  await browser.close();
}
