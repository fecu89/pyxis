import assert from "node:assert/strict";
import test, { after } from "node:test";
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import { build } from "esbuild";

const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT_MODULE_PATH || "playwright");
const adapters = {
  "next/dynamic": "import {lazy,Suspense} from 'react';export default load=>{const C=lazy(()=>load().then(m=>({default:m.default??m})));return p=><Suspense fallback={null}><C {...p}/></Suspense>}",
  "next/navigation": "export const useRouter=()=>({push(){},refresh(){}});export const useParams=()=>({slug:'fixture'});",
  "next/link": "export default ({href,children,...p})=><a href={href} {...p}>{children}</a>",
};
// Real composer, queue, transport and CSS; only Next routing and the network are fixtures.
const bundle = await build({ stdin: { contents: `
import {useState} from 'react';import {createRoot} from 'react-dom/client';
import {PostComposer} from '@/components/pad/post-composer';
import {UploadQueueList} from '@/components/pad/attachments/upload-queue-list';
import {AppDialogProvider} from '@/components/ui/app-dialog';
import {defaultPostFieldConfig} from '@/lib/post-fields/defaults';
function App(){const [open,setOpen]=useState(true);
if(location.search.includes('row'))return <UploadQueueList items={[{id:'a',file:new File(['fixture'],'photo.png',{type:'image/png'}),status:'uploading',progress:50,error:null,attachment:null}]} onCancel={()=>{}} onRemove={()=>{}} onRetry={()=>{}}/>;
return <AppDialogProvider>{open?<PostComposer open sectionId="s" sectionTitle="fixture" presentation={location.search.includes('inline')?'inline':'modal'}
fieldConfig={{...defaultPostFieldConfig,body:{...defaultPostFieldConfig.body,visible:false}}}
onClose={()=>setOpen(false)}/>:<h2>게시 완료</h2>}</AppDialogProvider>}
createRoot(document.getElementById('root')).render(<App/>);
`, loader: "tsx", resolveDir: process.cwd() }, bundle: true, write: false, outdir: "/tmp/pad-progress-browser-bundle", format: "iife", jsx: "automatic",
  define: { "process.env.NODE_ENV": '"production"' }, plugins: [{ name: "next-adapters", setup(b) {
    b.onResolve({ filter: /.*/ }, a => Object.hasOwn(adapters, a.path) ? { path: a.path, namespace: "fixture" } : undefined);
    b.onLoad({ filter: /.*/, namespace: "fixture" }, a => ({ contents: adapters[a.path], loader: "tsx", resolveDir: process.cwd() }));
  } }],
});
const browser = await chromium.launch({ headless: true });
after(() => browser.close());
const globalCss = readFileSync("app/globals.css", "utf8").replace('@import "tailwindcss";', "");

async function fixture(t, query = "", width = 900) {
  const page = await browser.newPage({ viewport: { width, height: 740 } });
  page.setDefaultTimeout(4000);
  const errors = [];
  page.on("pageerror", e => errors.push(e.message));
  let releaseFinal;
  const finalReady = new Promise(resolve => { releaseFinal = resolve; });
  const attachments = [];
  await page.route("https://fixture.local/**", async route => {
    const url = new URL(route.request().url());
    const json = body => route.fulfill({ contentType: "application/json", body: JSON.stringify(body) });
    if (url.pathname === "/api/upload-policy") return json({});
    if (url.pathname === "/api/sections/s/posts") return json({ post: { id: "p", version: 1, attachments: [] } });
    if (url.pathname === "/api/posts/p") {
      await finalReady;
      return json({ post: { id: "p", version: 2, body: "", attachments } });
    }
    return route.fulfill({ contentType: "text/html", body: '<div id="root"></div>' });
  });
  await page.addInitScript(() => {
    window.uploads = [];
    window.XMLHttpRequest = class extends EventTarget {
      upload = new EventTarget();
      open(method, url) { this.method = method; this.url = url; }
      send(body) { this.file = body.get("file"); window.uploads.push(this); }
      abort() { this.dispatchEvent(new Event("abort")); }
      advance(loaded, total = 100) { this.upload.dispatchEvent(new ProgressEvent("progress", { lengthComputable: true, loaded, total })); }
      transferred() { this.upload.dispatchEvent(new Event("load")); }
      finish(ok = true) {
        this.status = ok ? 201 : 500;
        this.response = ok ? { attachment: { id: this.file.name, type: "IMAGE", originalName: this.file.name, mimeType: this.file.type, fileSize: this.file.size, width: 16, height: 12 } } : { error: "fixture upload failed" };
        this.dispatchEvent(new Event("load"));
      }
    };
  });
  await page.goto(`https://fixture.local/${query}`);
  await page.addStyleTag({ content: globalCss });
  for (const output of bundle.outputFiles) {
    if (output.path.endsWith(".css")) await page.addStyleTag({ content: output.text });
    if (output.path.endsWith(".js")) await page.addScriptTag({ content: output.text });
  }
  t.after(async () => { releaseFinal(); await page.close(); assert.deepEqual(errors, []); });
  return { page, releaseFinal };
}

async function start(page, sizes = [1000]) {
  await page.locator('input[type="file"]').first().setInputFiles(sizes.map((size, i) => ({ name: `photo-${i}.png`, mimeType: "image/png", buffer: Buffer.alloc(size) })));
  await page.getByRole("list", { name: `첨부 파일 ${sizes.length}개`, exact: true }).waitFor();
  await page.getByRole("button", { name: "게시하기", exact: true }).click();
  await page.waitForFunction(count => window.uploads.length === count, Math.min(3, sizes.length));
}

test("single file progress paints a nonzero bar at 50 percent", async t => {
  const { page } = await fixture(t, "?row");
  const bar = page.getByRole("progressbar");
  await bar.waitFor();
  const ratio = await bar.evaluate(track => track.firstElementChild.getBoundingClientRect().width / track.getBoundingClientRect().width);
  assert(Math.abs(ratio - 0.5) < 0.01, `visible fill ratio=${ratio}, expected 0.5`);
});

test("single file progress exposes a visible percentage, not only aria-valuenow", async t => {
  const { page } = await fixture(t, "?row");
  const list = page.getByRole("list");
  await list.waitFor();
  assert.match(await list.innerText(), /50%/);
});

test("normal upload does not claim an attachment failed before it has finished", async t => {
  const { page } = await fixture(t);
  await start(page);
  assert.equal(await page.getByText("실패한 첨부를 재시도한 뒤 다시 게시해 주세요.", { exact: true }).count(), 0);
});

for (const presentation of ["modal", "inline"]) {
  test(`${presentation}: transfer, server-save and final-save states stay distinct on mobile`, async t => {
    const { page, releaseFinal } = await fixture(t, presentation === "inline" ? "?inline" : "", 375);
    await start(page);
    const row = page.getByRole("list", { name: "첨부 파일 1개", exact: true });
    const summary = page.getByRole("status", { name: "게시 진행상황" });
    await page.evaluate(() => window.uploads[0].advance(42));
    await page.waitForFunction(() => document.querySelector('[role="progressbar"]')?.getAttribute("aria-valuenow") === "42");
    assert.match(await row.innerText(), /업로드 중 42%/);
    assert.match(await summary.innerText(), /42%/);
    const box = await summary.boundingBox();
    assert(box && box.x >= 0 && box.x + box.width <= 375 && box.y >= 0 && box.y + box.height <= 740);
    // A long editor/list must not scroll the summary out with the attachment rows.
    await page.evaluate(() => {
      const editor = document.querySelector('.composer-editor-scroll');
      const spacer = document.createElement('div');
      spacer.style.cssText = 'height:1800px;flex:none';
      editor.prepend(spacer);
      if (location.search.includes('inline')) window.scrollTo(0, 800);
      else editor.scrollTop = 800;
    });
    const afterScroll = await summary.boundingBox();
    assert(afterScroll && afterScroll.y >= 0 && afterScroll.y + afterScroll.height <= 740);
    await page.evaluate(() => window.uploads[0].advance(995, 1000));
    await page.waitForFunction(() => document.querySelector('[role="progressbar"]')?.getAttribute("aria-valuenow") === "99");
    assert.match(await row.innerText(), /업로드 중 99%/);
    await page.evaluate(() => window.uploads[0].transferred());
    await row.getByText(/서버 저장 확인 중/).waitFor();
    assert.match(await summary.innerText(), /서버 저장 확인 중/);
    assert.equal(await page.getByRole("heading", { name: "게시 완료" }).count(), 0);
    await page.evaluate(() => window.uploads[0].finish());
    await summary.getByText(/게시물 저장 중/).waitFor();
    releaseFinal();
    await page.getByRole("heading", { name: "게시 완료" }).waitFor();
  });
}

test("multiple-file summary is byte-weighted; cancellation and retry retain working controls", async t => {
  const { page, releaseFinal } = await fixture(t);
  await start(page, [1000, 3000]);
  const summary = page.getByRole("status", { name: "게시 진행상황" });
  await page.evaluate(() => window.uploads[0].advance(50));
  await summary.getByText(/13%/).waitFor(); // 500 / 4000 bytes, rounded.
  await page.getByRole("button", { name: "photo-0.png 업로드 취소", exact: true }).click();
  await page.evaluate(() => window.uploads[1].advance(50));
  await summary.getByText(/50%/).waitFor();
  await page.evaluate(() => window.uploads[1].finish(false));
  releaseFinal();
  await page.getByRole("button", { name: "다시 게시하기", exact: true }).waitFor();
  await page.getByText("실패한 첨부를 재시도한 뒤 다시 게시해 주세요.", { exact: true }).waitFor();
  await page.getByRole("button", { name: "photo-1.png 다시 시도", exact: true }).click();
  await page.waitForFunction(() => window.uploads.length === 3);
  await page.evaluate(() => window.uploads[2].advance(25));
  await summary.getByText(/25%/).waitFor();
  assert.equal(await page.getByText("실패한 첨부를 재시도한 뒤 다시 게시해 주세요.", { exact: true }).count(), 0);
});
