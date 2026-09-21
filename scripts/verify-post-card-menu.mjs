// 실제 PadCanvas/PostCard/작성기/대화상자를 메모리 fixture로 구동합니다. 운영 API·DB 접근 없음.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { verifyPadDragRegressions } from "./verify-pad-drag-regressions.mjs";

const require = createRequire(import.meta.url);
const root = fileURLToPath(new URL("..", import.meta.url));
const { build } = require("esbuild");
const { chromium } = require(process.env.PLAYWRIGHT_MODULE_PATH || "playwright");
const adapters = {
  "next/link": `export default function Link({href,children,prefetch,...props}) { return <a {...props} href={href}>{children}</a>; }`,
  "next/image": `export default function Image({fill,priority,unoptimized,...props}) { return <img {...props}/>; }`,
  "next/navigation": `const router={push:url=>window.navigations.push(url),replace:url=>window.navigations.push(url),refresh:()=>window.navigations.push('refresh')};export const useRouter=()=>router;export const useParams=()=>({slug:'fixture'});export const usePathname=()=>'/b/fixture';export const useSearchParams=()=>new URLSearchParams();`,
  "next/dynamic": `import {lazy,Suspense} from 'react';export default function dynamic(load){const C=lazy(()=>load().then(m=>({default:m.default??m})));return props=><Suspense fallback={null}><C {...props}/></Suspense>;}`,
};
const entry = `
import {createRoot} from 'react-dom/client';
import {PadCanvas} from '@/components/pad/pad-canvas';
import {GuestIdentityProvider} from '@/components/pad/guest-identity';
import {AppDialogProvider} from '@/components/ui/app-dialog';
import {defaultPostFieldConfig} from '@/lib/post-fields/defaults';
import {UPLOAD_POLICY_DEFAULTS} from '@/lib/files/upload-policy-shape';
window.navigations=[];window.calls=[];window.failDelete=false;window.sources=[];
window.EventSource=class {static CLOSED=2;readyState=1;handlers={};constructor(url){this.url=url;window.sources.push(this)}addEventListener(name,fn){this.handlers[name]=fn}close(){this.readyState=2}};
window.fetch=async(url,init={})=>{
  url=String(url);window.calls.push({url,method:init.method??'GET',body:init.body});
  const json=(body,status=200)=>new Response(JSON.stringify(body),{status,headers:{'content-type':'application/json'}});
  if(url==='/api/posts/post/reorder')return new Promise(resolve=>{
    const body=JSON.parse(init.body);
    window.pendingMoves.push({body,finish:({emit=true,fail=false,deferResponse=false}={})=>{
      if(fail){resolve(json({error:'이동 저장 실패'},500));return;}
      const sections=window.fixture.board.sections;
      const post=sections.flatMap(section=>section.posts).find(post=>post.id==='post');
      const moved={...post,position:1024,version:post.version+1};
      for(const section of sections){section.posts=section.posts.filter(post=>post.id!=='post');}
      sections.find(section=>section.id===body.targetSectionId).posts.push(moved);
      for(const section of sections)section.totalPostCount=section.posts.length;
      const postMove={sectionId:body.targetSectionId,position:moved.position,version:moved.version,previousItemId:body.previousItemId,nextItemId:body.nextItemId};
      const event={type:'post.reordered',entityId:'post',sectionId:postMove.sectionId,payload:{postMove}};
      window.moveEvents.push(event);if(emit)window.emit(event);
      if(deferResponse)window.delayedMoveResponse=()=>resolve(json({ok:true,postMove}));
      else resolve(json({ok:true,postMove}));
    }});
  });
  if(url==='/api/upload-policy')return json(UPLOAD_POLICY_DEFAULTS);
  if(url==='/api/boards/board/realtime-snapshot')return json({data:window.fixture});
  if(url==='/api/sections/section-0/posts?cursor=post')return json({posts:[{...window.fixture.board.sections[0].posts[0],id:'post-2',title:'더 불러온 게시물',isMine:false}],nextCursor:null});
  if(url==='/api/sections/section-0/posts?cursor=restored'){
    window.fixture.board.sections[0].posts=[window.deletedPost];
    return json({posts:[window.deletedPost],nextCursor:null});
  }
  if(url==='/api/posts/post'&&init.method==='DELETE'){
    if(window.failDelete)return json({error:'삭제 권한이 없습니다.'},403);
    window.deletedPost=window.fixture.board.sections[0].posts[0];
    window.fixture.board.sections[0].posts=[];window.fixture.board.sections[0].totalPostCount-=1;
    if(window.deleteEarly)window.emit({type:'post.deleted',entityId:'post',sectionId:'section-0'});
    return json({ok:true});
  }
  if(url==='/api/posts/post'&&init.method==='PATCH'){
    const body=JSON.parse(init.body);const current=window.fixture.board.sections[0].posts[0];
    if(body.version!==current.version)return json({error:'다른 사용자가 수정했습니다.'},409);
    const post={...current,...body,version:current.version+1};window.fixture.board.sections[0].posts=[post];
    const response=json({post});
    if(window.lateAttachment&&body.attachmentCount!==undefined)window.emit({type:'attachment.created',entityId:'attachment-late',postId:'post',payload:{attachment:{id:'attachment-late',type:'LINK',originalName:'동시에 추가된 링크',externalUrl:'https://example.org/latest',mimeType:'text/html',fileSize:0}}});
    return response;
  }
  throw Error('Unexpected request: '+(init.method??'GET')+' '+url);
};
const root=createRoot(document.getElementById('root'));let sequence=0;
window.render=(options={})=>{
  const {mine=true,any=false,own=true,deleteAny=false,frozen=false,guest=false,showAuthor=true,layout='SECTIONS',pinned=false,status='PUBLISHED'}=options;
  const post={id:'post',title:'테스트 게시물',body:'원래 본문',bodyFormat:'MARKDOWN',status,moderationReason:null,customFieldValues:null,position:1,isPinned:pinned,version:1,createdAt:'2026-09-15T00:00:00Z',updatedAt:'2026-09-15T00:00:00Z',author:{id:guest?'':'author',name:'아주 긴 작성자 이름을 가진 테스트 사용자',image:null,isGuest:guest},isMine:mine,attachments:[],viewerReacted:false,reactionCount:0,viewerReactions:[],reactionCounts:{},commentCount:0,comments:[]};
  const userId=guest?null:'viewer';
  const data={board:{id:'board',slug:'fixture',title:'테스트 패드',description:null,discoveryScope:'LINK',visitorPermission:'WRITER',loginRequired:false,hasPassword:false,state:frozen?'FROZEN':'ACTIVE',moderationMode:'NONE',guestPostsRequireApproval:true,freezeAt:null,layout,sortMode:'MANUAL',newPostPlacement:'END',cardSize:'MEDIUM',font:'SANS',backgroundColor:null,backgroundImageUrl:null,accentColor:null,showAuthor,showTimestamp:true,reactionPolicy:'SINGLE',attachmentDownloadPolicy:'READERS',postFieldConfig:defaultPostFieldConfig,allowComments:false,allowReactions:false,allowMemberPosting:true,allowMemberFileUpload:true,owner:{id:'owner',name:'선생님'},memberCount:0,members:[],sections:Array.from({length:8},(_,i)=>({id:'section-'+i,title:'섹션 '+i,description:null,position:i,version:1,totalPostCount:i===0?1:0,nextCursor:null,posts:i===0?[post]:[]}))},currentRole:any?'OWNER':guest?null:'MEMBER',isFavorite:false,capabilities:{manageBoard:any,archiveBoard:any,viewTrash:any,createPost:own||any,editAnyPost:any,deleteAnyPost:deleteAny||any,editOwnContent:own,moderateComments:any,comment:false,react:false,moderatePosts:any,downloadAttachments:true},viewer:{userId,guestWriteOpen:guest,guestName:guest?'손님':null},initialFrozen:frozen};
  if(options.paginated){data.board.sections[0].nextCursor='post';data.board.sections[0].totalPostCount=2;}
  if(options.body)post.body=options.body;
  window.pendingMoves=[];window.moveEvents=[];
  window.fixture=structuredClone(data);
  root.render(<AppDialogProvider key={++sequence}><div className="zone-frame"><div className="app-shell"><div className="app-shell-content"><GuestIdentityProvider boardId="board" viewer={data.viewer}><PadCanvas initialData={data} currentUserId={userId} initialFrozen={frozen} initialNotifications={null}/></GuestIdentityProvider></div></div></div></AppDialogProvider>);
};
window.emit=(event)=>{for(const source of window.sources)if(source.readyState!==2&&source.url==='/api/boards/board/events')source.handlers['board-change']?.({data:JSON.stringify(event)})};
window.freeze=(state='FROZEN')=>{window.fixture.board.state=state;window.emit({type:'board.updated',entityId:'board',payload:{boardPatch:{state}}})};
`;
const bundle = await build({
  stdin: { contents: entry, loader: "tsx", resolveDir: root }, absWorkingDir: root,
  bundle: true, write: false, outdir: "/tmp/pyxis-post-card-menu-bundle", format: "iife", jsx: "automatic",
  define: { "process.env.NODE_ENV": '"production"', "process.env": "{}" },
  plugins: [{ name: "next-browser-adapters", setup(builder) {
    builder.onResolve({ filter: /.*/ }, (args) => Object.hasOwn(adapters, args.path) ? { path: args.path, namespace: "adapter" } : undefined);
    builder.onLoad({ filter: /.*/, namespace: "adapter" }, (args) => ({ contents: adapters[args.path], loader: "tsx", resolveDir: root }));
  } }],
});
const cssPath = `${root}/app/globals.css`;
const css = (await require("postcss")([require("@tailwindcss/postcss")()]).process(readFileSync(cssPath, "utf8"), { from: cssPath })).css;
const browser = await chromium.launch({ headless: true });
try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  page.setDefaultTimeout(10000);
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.route("http://fixture.local/**", (route) => route.fulfill({ body: '<div id="root"></div>', contentType: "text/html" }));
  await page.goto("http://fixture.local");
  await page.addStyleTag({ content: css });
  for (const file of bundle.outputFiles) {
    if (file.path.endsWith(".css")) await page.addStyleTag({ content: file.text });
    if (file.path.endsWith(".js")) await page.addScriptTag({ content: file.text });
  }
  const card = page.locator(".post-card").first();
  const trigger = () => card.getByRole("button", { name: "테스트 게시물 옵션", exact: true });
  const panel = () => page.getByRole("group", { name: "테스트 게시물 옵션", exact: true });
  async function render(options = {}) {
    await page.evaluate((options) => {
      window.render(options);
      return new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    }, options);
    await card.waitFor();
    assert.deepEqual(errors, []);
  }
  for (const [label, options, expected] of [
    ["본인 글", {}, 1], ["다른 사람 글", { mine: false }, 0],
    ["읽기 전용인 본인 글", { own: false }, 0], ["관리자", { mine: false, any: true }, 1],
    ["동결된 관리자", { any: true, frozen: true }, 0], ["본인 손님 글", { guest: true }, 1],
    ["다른 손님 글", { guest: true, mine: false }, 0], ["손님 쓰기 차단", { guest: true, own: false }, 0],
  ]) {
    await render(options);
    assert.equal(await trigger().count(), expected, label);
  }
  await render({ mine: false, own: false, deleteAny: true });
  assert.equal(await trigger().count(), 1, "삭제 전용 운영 권한도 메뉴 표시");
  await trigger().click();
  assert.equal(await panel().getByRole("button", { name: "게시물 수정", exact: true }).count(), 0);
  assert.equal(await panel().getByRole("button", { name: "게시물 삭제", exact: true }).count(), 1);
  for (const width of [1280, 390, 320]) {
    await page.setViewportSize({ width, height: 900 });
    await render({ showAuthor: false });
    await trigger().click();
    await panel().waitFor();
    assert.equal(await panel().evaluate((el) => el.parentElement.tagName), "BODY");
    const box = await panel().boundingBox();
    assert(box.x >= 0 && box.x + box.width <= width + 1 && box.y >= 0 && box.y + box.height <= 901);
    assert.deepEqual(await page.evaluate(() => window.navigations), [], "메뉴를 눌러도 상세 페이지로 이동하지 않음");
    await page.keyboard.press("Escape");
    await panel().waitFor({ state: "detached" });
    assert(await trigger().evaluate((el) => el === document.activeElement));
    await render({ guest: true, pinned: true, status: "PENDING" });
    const cardBox = await card.boundingBox();
    const triggerBox = await trigger().boundingBox();
    assert(triggerBox.x >= cardBox.x && triggerBox.x + triggerBox.width <= cardBox.x + cardBox.width, "작성자·손님·고정·승인 배지와 메뉴가 카드 안에 표시됨");
    assert(await trigger().evaluate((el) => { const r = el.getBoundingClientRect(); return el.contains(document.elementFromPoint(r.right - 2, r.y + r.height / 2)); }), "메뉴 오른쪽 끝도 카드에 잘리지 않음");
  }
  await page.setViewportSize({ width: 1280, height: 900 });
  for (const layout of ["WALL", "GRID", "STREAM", "TIMELINE", "TABLE"]) {
    await render({ layout });
    assert.equal(await trigger().count(), 1, layout);
  }
  for (const [width, guest] of [[1280, false], [390, true]]) {
    await page.setViewportSize({ width, height: 900 });
    await render({ guest, paginated: true });
    await page.evaluate(() => { window.lateAttachment = true; });
    await page.getByRole("button", { name: "이전 글 더 보기", exact: false }).click();
    await page.getByText("더 불러온 게시물", { exact: true }).waitFor();
    const previous = await page.evaluate(() => window.calls.length);
    await trigger().click();
    await panel().getByRole("button", { name: "게시물 수정", exact: true }).click();
    const editor = page.locator('.composer-markdown-editor [contenteditable="true"]');
    await editor.waitFor();
    assert.equal(await page.locator(".modal-backdrop").evaluate((el) => el.parentElement.tagName), "BODY");
    await editor.fill("카드 메뉴에서 수정한 본문");
    await page.getByRole("button", { name: "수정하기", exact: true }).click();
    await page.getByRole("dialog").waitFor({ state: "detached" });
    await card.getByText("카드 메뉴에서 수정한 본문", { exact: true }).waitFor();
    assert.equal(await page.getByText("더 불러온 게시물", { exact: true }).count(), 1, "저장 후 추가로 불러온 페이지 보존");
    assert.equal(await card.getByText("링크", { exact: true }).count(), 1, "저장 응답 직전 도착한 첨부 SSE를 보존");
    await page.evaluate(() => { window.lateAttachment = false; });
    const patches = await page.evaluate((previous) => window.calls.slice(previous).filter((call) => call.method === "PATCH").map((call) => ({ url: call.url, body: JSON.parse(call.body) })), previous);
    assert.equal(patches.length, 2);
    assert(patches.every((patch) => patch.url === "/api/posts/post"));
    assert.equal(patches[0].body.version, 1);
    assert.equal(patches[1].body.version, 2);
    if (guest) assert(patches.every((patch) => !Object.hasOwn(patch.body, "isPinned")));
    assert.deepEqual(await page.evaluate(() => window.navigations), []);
  }
  await page.setViewportSize({ width: 1280, height: 900 });
  await render();
  await trigger().click();
  await panel().getByRole("button", { name: "게시물 수정", exact: true }).click();
  const conflictEditor = page.locator('.composer-markdown-editor [contenteditable="true"]');
  await conflictEditor.fill("저장 전 내 초안");
  await page.evaluate(() => {
    const post = window.fixture.board.sections[0].posts[0];
    post.body = "다른 사용자의 변경";
    post.version = 2;
    window.emit({ type: "post.updated", entityId: post.id, sectionId: "section-0", payload: { post } });
  });
  await card.getByText("다른 사용자의 변경", { exact: true }).waitFor();
  assert.equal(await conflictEditor.innerText(), "저장 전 내 초안", "실시간 수정이 편집 중인 초안을 지우면 안 됨");
  await page.getByRole("button", { name: "수정하기", exact: true }).click();
  await page.getByText("다른 사용자가 수정했습니다.", { exact: true }).waitFor();
  assert.equal(await conflictEditor.innerText(), "저장 전 내 초안", "버전 충돌 후 초안 보존");
  await render();
  await page.evaluate(() => {
    window.fixture.board.sections[0].totalPostCount = 5;
    window.emit({ type: "board.updated", entityId: "board", payload: { requiresSync: true } });
  });
  await page.locator(".section-count").first().getByText("5", { exact: true }).waitFor();
  await trigger().click();
  await panel().getByRole("button", { name: "게시물 삭제", exact: true }).click();
  await page.getByRole("dialog").getByRole("button", { name: "삭제", exact: true }).click();
  await card.waitFor({ state: "detached" });
  await page.evaluate(() => window.emit({ type: "post.deleted", entityId: "post", sectionId: "section-0" }));
  await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  assert.equal(await page.locator(".section-count").first().innerText(), "4", "삭제 응답 뒤 늦게 도착한 SSE도 한 번만 차감");
  await page.evaluate(() => {
    window.deletedPost.version += 2;
    window.fixture.board.sections[0].posts = [window.deletedPost];
    window.fixture.board.sections[0].totalPostCount = 5;
    window.emit({ type: "post.updated", entityId: "post", sectionId: "section-0", payload: { post: window.deletedPost } });
    window.deleteEarly = true;
  });
  await trigger().click();
  await panel().getByRole("button", { name: "게시물 삭제", exact: true }).click();
  await page.getByRole("dialog").getByRole("button", { name: "삭제", exact: true }).click();
  await card.waitFor({ state: "detached" });
  assert.equal(await page.locator(".section-count").first().innerText(), "4", "복구 후 다시 삭제 가능하고 SSE가 먼저 와도 한 번만 차감");
  await page.evaluate(() => { window.deleteEarly = false; });
  await page.evaluate(() => {
    window.deletedPost.version += 2;
    window.fixture.board.sections[0].nextCursor = "restored";
    window.fixture.board.sections[0].totalPostCount = 5;
    window.emit({ type: "board.updated", entityId: "board", payload: { requiresSync: true } });
  });
  await page.getByRole("button", { name: "이전 글 더 보기", exact: false }).click();
  await trigger().click();
  await panel().getByRole("button", { name: "게시물 삭제", exact: true }).click();
  await page.getByRole("dialog").getByRole("button", { name: "삭제", exact: true }).click();
  await card.waitFor({ state: "detached" });
  assert.equal(await page.locator(".section-count").first().innerText(), "4", "복구 알림을 놓쳐도 나중에 불러온 카드 재삭제 가능");
  await page.evaluate(() => { window.calls = []; });
  await render();
  await trigger().click();
  await panel().getByRole("button", { name: "게시물 삭제", exact: true }).click();
  await page.getByRole("dialog").waitFor();
  assert(await page.getByRole("dialog").innerText().then((text) => text.includes("첨부파일") && text.includes("영구 삭제")));
  await page.getByRole("dialog").getByRole("button", { name: "취소", exact: true }).click();
  assert.equal(await page.evaluate(() => window.calls.filter((call) => call.method === "DELETE").length), 0);
  await trigger().click();
  await panel().getByRole("button", { name: "게시물 삭제", exact: true }).click();
  await page.getByRole("dialog").getByRole("button", { name: "삭제", exact: true }).click();
  await card.waitFor({ state: "detached" });
  assert.equal(await page.evaluate(() => window.calls.filter((call) => call.url === "/api/posts/post" && call.method === "DELETE").length), 1);
  await render();
  await page.evaluate(() => { window.failDelete = true; });
  await trigger().click();
  await panel().getByRole("button", { name: "게시물 삭제", exact: true }).click();
  await page.getByRole("dialog").getByRole("button", { name: "삭제", exact: true }).click();
  await page.getByText("삭제 권한이 없습니다.", { exact: true }).waitFor();
  assert.equal(await card.count(), 1, "실패한 삭제는 카드를 남김");
  await render();
  await trigger().click();
  await page.evaluate(() => window.freeze());
  await trigger().waitFor({ state: "detached" });
  await panel().waitFor({ state: "detached" });
  await page.evaluate(() => window.freeze("ACTIVE"));
  await trigger().waitFor();
  assert.equal(await panel().count(), 0, "동결 해제 시 이전 메뉴가 자동으로 다시 열리지 않음");
  await trigger().click();
  await panel().getByRole("button", { name: "게시물 삭제", exact: true }).click();
  await page.getByRole("dialog").waitFor();
  const beforeFreeze = await page.evaluate(() => window.calls.filter((call) => call.method === "DELETE").length);
  await page.evaluate(() => window.freeze());
  await trigger().waitFor({ state: "detached" });
  await page.getByRole("dialog").getByRole("button", { name: "삭제", exact: true }).click();
  await page.getByRole("dialog").waitFor({ state: "detached" });
  assert.equal(await page.evaluate(() => window.calls.filter((call) => call.method === "DELETE").length), beforeFreeze, "삭제 확인 중 동결되면 요청하지 않음");
  await render();
  const dragTarget = await trigger().boundingBox();
  await page.mouse.move(dragTarget.x + 4, dragTarget.y + 12);
  await page.mouse.down();
  await page.mouse.move(dragTarget.x + 22, dragTarget.y + 14, { steps: 6 });
  assert.equal(await page.locator(".post-card.dragging").count(), 0, "옵션 버튼의 포인터 동작은 카드 드래그를 시작하지 않음");
  await page.mouse.up();
  assert.deepEqual(await page.evaluate(() => window.navigations), []);
  assert.deepEqual(errors, []);
  await verifyPadDragRegressions(page, render);
  assert.deepEqual(errors, []);
  console.log("PASS 게시물 카드 메뉴: 본인·관리자·삭제 전용·손님·동결 권한, 6종 레이아웃, 모바일, 포털, 즉시 수정·409 초안·페이지 보존, 삭제 확인·취소·실패·동결·SSE 순서·복구, 드래그 분리");
} finally {
  await browser.close();
}
