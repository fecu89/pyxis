// 실제 편집기/저장 훅을 브라우저에서 검증합니다. 인증·운영 API·DB에 접근하지 않습니다.
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const root = fileURLToPath(new URL("..", import.meta.url));
const { chromium } = require(process.env.PLAYWRIGHT_MODULE_PATH || "playwright");
const adapters = {
  "next/navigation": `export const useRouter=()=>({push(){},replace(){},refresh(){}});`,
  "next/dynamic": `import {lazy,Suspense} from 'react';export default function dynamic(load){const C=lazy(()=>load().then(m=>({default:m.default??m})));return props=><Suspense fallback={null}><C {...props}/></Suspense>;}`,
  "next/link": `export default function Link({href,children,prefetch,...props}){return <a href={href} {...props}>{children}</a>}`,
  "next/image": `export default function Image({fill,priority,unoptimized,...props}){return <img {...props}/>}`,
};
const bundle = await require("esbuild").build({
  stdin: { loader: "tsx", resolveDir: root, contents: `
    import {createRoot} from 'react-dom/client';
    import {FormEditor} from '@/components/forms/form-editor';
    import {AppDialogProvider} from '@/components/ui/app-dialog';
    import {blankField} from '@/components/forms/field-model';
    import {formSaveSchema} from '@/lib/forms/field-schema';
    const root=createRoot(document.getElementById('root'));let sequence=0;
    window.fetch=async(url,init)=>{
      if(url!='/api/forms/fixture'||init?.method!=='PUT')throw Error('Unexpected request: '+url);
      const body=JSON.parse(init.body);const parsed=formSaveSchema.safeParse(body);
      const reply=window.reply;
      window.calls.push({body,valid:parsed.success});
      if(window.hold)await new Promise(resolve=>window.release=resolve);
      if(reply==='network')throw Error('fixture connection failure');
      if(reply)return new Response(JSON.stringify(reply.body),{status:reply.status,headers:{'content-type':'application/json'}});
      if(!parsed.success)return new Response(JSON.stringify({code:'FORM_VALIDATION_ERROR',error:parsed.error.issues[0].message}),{status:400,headers:{'content-type':'application/json'}});
      if(body.expectedUpdatedAt!==window.initial.updatedAt)return new Response(JSON.stringify({error:'다른 곳에서 먼저 저장했습니다.',needsReload:true}),{status:409,headers:{'content-type':'application/json'}});
      window.initial={...window.initial,...body,updatedAt:new Date(Date.parse(window.initial.updatedAt)+1000).toISOString(),fields:body.fields.map(f=>({...blankField(f.type),...f,id:f.id??f.clientId}))};
      return new Response(JSON.stringify({form:window.initial}),{headers:{'content-type':'application/json'}});
    };
    window.render=(types=['IMAGE','PDF','DOCUMENT'])=>{
      window.calls=[];window.hold=false;window.reply=null;
      window.initial={id:'fixture',slug:'fixture',status:'DRAFT',updatedAt:'2026-09-17T00:00:00.000Z',title:'자동저장 회귀 검증',description:null,requiresLogin:true,allowMultipleResponses:false,allowEditAfterSubmit:false,shuffleFields:false,showProgressBar:true,confirmationMessage:null,closedMessage:null,openAt:null,closeAt:null,maxResponses:null,_count:{responses:0},availableSubjects:[],fields:[{...blankField('FILE_UPLOAD'),id:'field',clientId:'field',title:'첨부 질문',fileAllowedTypes:types}]};
      root.render(<AppDialogProvider key={++sequence}><FormEditor formId="fixture" initialForm={window.initial}/></AppDialogProvider>);
    };
  ` },
  absWorkingDir: root, bundle: true, write: false, outdir: "/tmp/pyxis-form-autosave-bundle", format: "iife", jsx: "automatic",
  define: { "process.env.NODE_ENV": '"production"' },
  plugins: [{ name: "next-adapters", setup(builder) {
    builder.onResolve({ filter: /.*/ }, (args) => Object.hasOwn(adapters, args.path) ? { path: args.path, namespace: "adapter" } : undefined);
    builder.onLoad({ filter: /.*/, namespace: "adapter" }, (args) => ({ contents: adapters[args.path], loader: "tsx", resolveDir: root }));
  } }],
});

const browser = await chromium.launch({ headless: true });
try {
  const page = await browser.newPage();
  page.setDefaultTimeout(5000);
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.route("**/*", (route) => route.request().url() === "http://fixture.local/"
    ? route.fulfill({ contentType: "text/html", body: '<!doctype html><html lang="ko"><body><div id="root"></div></body></html>' })
    : route.abort());
  await page.goto("http://fixture.local/");
  for (const file of bundle.outputFiles) {
    if (file.path.endsWith(".js")) await page.addScriptTag({ content: file.text });
    if (file.path.endsWith(".css")) await page.addStyleTag({ content: file.text });
  }
  await page.clock.install();
  await page.clock.pauseAt(new Date());
  const checkbox = (name) => page.getByRole("checkbox", { name, exact: true });
  const title = page.getByRole("textbox", { name: "1번 질문 내용", exact: true });
  const save = page.getByRole("button", { name: "설문 저장", exact: true });
  const alerts = () => page.getByRole("alert").allTextContents();
  const calls = () => page.evaluate(() => window.calls);
  async function render(types) {
    await page.evaluate((types) => window.render(types), types);
    await checkbox("이미지").waitFor();
  }
  async function waitForSave() {
    await page.waitForFunction(() => !document.querySelector('[aria-busy="true"]'));
  }
  async function autoSave() {
    await page.clock.runFor(30_000);
    await waitForSave();
  }
  async function releaseSave() {
    await page.evaluate(() => { window.hold = false; window.release(); });
    await waitForSave();
  }

  // 빈 유형은 일반 클릭으로는 만들 수 없으므로 명시적인 비정상 입력 fixture로 검증합니다.
  // 원인은 서버 검증 실패 뒤 이미 수정한 문서에 낡은 오류를 덮어씌우는 응답 처리입니다.
  await render([]);
  await title.fill("입력 중인 질문");
  await page.evaluate(() => { window.hold = true; });
  await page.clock.runFor(30_000);
  await page.waitForFunction(() => window.calls.length === 1);
  await checkbox("PDF").check();
  await releaseSave();
  assert.deepEqual(await alerts(), [], "수정 이전 자동저장의 늦은 검증 오류는 현재 화면에 표시하지 않음");
  assert(await save.isEnabled(), "실패를 무시해도 수정 사항은 미저장 상태 유지");
  await autoSave();
  assert.deepEqual((await calls()).at(-1).body.fields[0].fileAllowedTypes, ["PDF"]);
  assert(await save.isDisabled(), "다음 주기에 현재 값이 실제 저장되면 dirty 해제");
  console.log("PASS: 늦은 자동저장 검증 오류 제외·다음 저장에서 수정 값 반영");

  await render([]);
  await title.fill("오류가 난 현재 문서");
  await autoSave();
  assert.deepEqual(await alerts(), ["허용할 파일 유형을 1개 이상 선택해 주세요."], "현재 파일 설정의 오류는 이해할 수 있는 문구로 안내");
  await checkbox("PDF").check();
  assert.deepEqual(await alerts(), [], "새 편집은 이전 검증 오류를 즉시 지움");
  assert(await save.isEnabled());
  await autoSave();
  assert((await calls()).at(-1).valid);
  assert(await save.isDisabled());
  console.log("PASS: 현재 오류 표시·수정 시 즉시 해제·자동 재저장");

  await render();
  for (const name of ["이미지", "PDF", "문서"]) {
    await checkbox(name).click();
    await autoSave();
  }
  assert(await checkbox("문서").isChecked(), "마지막 파일 유형을 지우는 요청은 기존처럼 차단");
  assert((await calls()).every((call) => call.valid && call.body.fields[0].fileAllowedTypes.length > 0));
  assert.deepEqual(await alerts(), []);
  console.log("PASS: 첨부 체크 변경 중 자동저장에 빈 유형을 보내지 않음");

  await render();
  await checkbox("이미지").click();
  await page.evaluate(() => { window.hold = true; });
  await page.clock.runFor(30_000);
  await page.waitForFunction(() => window.calls.length === 1);
  await checkbox("PDF").click();
  await checkbox("동영상").check();
  await checkbox("문서").click();
  await releaseSave();
  assert(await checkbox("동영상").isChecked());
  assert.equal(await checkbox("문서").isChecked(), false, "늦은 성공 응답이 새 편집을 덮어쓰지 않음");
  assert(await save.isEnabled());
  await autoSave();
  assert.deepEqual((await calls()).at(-1).body.fields[0].fileAllowedTypes, ["VIDEO"]);
  assert.equal((await calls()).at(-1).body.expectedUpdatedAt, "2026-09-17T00:00:01.000Z", "다음 저장은 최신 서버 버전 사용");
  assert.deepEqual(await alerts(), []);
  assert(await save.isDisabled());
  console.log("PASS: 성공 응답의 편집 보존·문서 버전 병합 유지");

  await render();
  const formTitle = page.getByRole("textbox", { name: "설문지 제목", exact: true });
  await formTitle.fill("");
  await autoSave();
  assert.deepEqual(await alerts(), ["설문 제목을 입력해 주세요."]);
  assert.equal((await calls()).length, 0, "빈 제목은 HTTP 저장 전에 차단");
  await formTitle.fill("수정한 설문 제목");
  assert.deepEqual(await alerts(), [], "문서 설정 입력도 이전 검증 오류를 제거");
  await autoSave();
  assert.equal((await calls()).at(-1).body.title, "수정한 설문 제목");
  console.log("PASS: 문서 제목의 입력 검증·수정 후 자동저장");

  await render();
  await title.fill("유형을 바꿔도 남아야 하는 질문");
  const typeTrigger = page.getByRole("button", { name: /^질문 유형:/ });
  const typeMenu = page.getByRole("group", { name: "질문 유형 옵션", exact: true });
  await typeTrigger.click();
  await typeMenu.getByRole("button", { name: /^단답형/ }).click();
  await autoSave();
  let savedField = (await calls()).at(-1).body.fields[0];
  assert.equal(savedField.id, "field");
  assert.equal(savedField.type, "SHORT_TEXT");
  assert.equal(savedField.title, "유형을 바꿔도 남아야 하는 질문");
  assert.equal(Object.hasOwn(savedField, "fileAllowedTypes"), false, "다른 유형의 파일 설정을 저장하지 않음");
  await typeTrigger.click();
  await typeMenu.getByRole("button", { name: /^파일 업로드/ }).click();
  await autoSave();
  savedField = (await calls()).at(-1).body.fields[0];
  assert.equal(savedField.id, "field");
  assert.equal(savedField.type, "FILE_UPLOAD");
  assert.equal(savedField.title, "유형을 바꿔도 남아야 하는 질문");
  assert.deepEqual(savedField.fileAllowedTypes, ["IMAGE", "PDF", "DOCUMENT"]);
  assert.deepEqual(await alerts(), []);
  console.log("PASS: 공용 메뉴로 유형 변경 후 질문 ID·문구 보존·자동저장 연동");

  for (const [label, reply, expected] of [
    ["질문 ID 불일치", { status: 400, body: { error: "저장할 질문 목록이 현재 설문과 일치하지 않습니다. 새로고침 후 다시 시도해 주세요." } }, "저장할 질문 목록이 현재 설문과 일치하지 않습니다. 새로고침 후 다시 시도해 주세요."],
    ["버전 충돌", { status: 409, body: { error: "다른 곳에서 먼저 저장했습니다.", needsReload: true } }, "다른 곳에서 먼저 저장했습니다."],
    ["권한 거절", { status: 403, body: { error: "저장 권한이 없습니다." } }, "저장 권한이 없습니다."],
    ["인증 만료", { status: 401, body: { error: "로그인이 필요합니다." } }, "로그인이 필요합니다."],
    ["서버 장애", { status: 500, body: { error: "설문을 저장하지 못했습니다." } }, "설문을 저장하지 못했습니다."],
    ["네트워크 장애", "network", "네트워크 연결을 확인한 뒤 다시 저장해 주세요."],
  ]) {
    await render();
    await page.evaluate((reply) => { window.reply = reply; window.hold = true; }, reply);
    await checkbox("이미지").click();
    await page.clock.runFor(30_000);
    await page.waitForFunction(() => window.calls.length === 1);
    await checkbox("PDF").click();
    await releaseSave();
    assert.deepEqual(await alerts(), [expected], `${label}은 새 편집이 있어도 숨기면 안 됨`);
    await title.fill("오류 이후 새 편집");
    assert.deepEqual(await alerts(), [expected], `${label}은 입력 오류처럼 지우지 않음`);
    assert(await save.isEnabled());
    console.log(`PASS: ${label} 안내와 미저장 상태 유지`);
  }
  assert.deepEqual(errors, [], "브라우저 실행 오류 없음");
} finally {
  await browser.close();
}
