// 실제 설정 탭·접근 요청 UI를 실행하고 HTTP만 메모리 fixture로 대체합니다.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const root = fileURLToPath(new URL("..", import.meta.url));
const { chromium } = require(process.env.PLAYWRIGHT_MODULE_PATH || "playwright");
const bundle = await require("esbuild").build({
  stdin: { loader: "tsx", resolveDir: root, contents: `
    import {createRoot} from 'react-dom/client';
    import {PadSettingsTabs} from '@/components/pad/settings/pad-settings-tabs';
    import {AppDialogProvider} from '@/components/ui/app-dialog';
    import {defaultPostFieldConfig} from '@/components/pad/settings/types';
    const root=createRoot(document.getElementById('root'));let sequence=0;
    const noop=()=>{};
    const owner={role:'OWNER',user:{id:'owner',name:'관리자',loginIdentifier:'owner',image:null}};
    const applicant={id:'applicant',name:'신청자',loginIdentifier:'applicant',image:null};
    const board={id:'fixture',title:'설정 검증',description:null,discoveryScope:'PRIVATE',visitorPermission:'NO_ACCESS',loginRequired:true,hasPassword:false,guestPostsRequireApproval:true,memberCount:1,members:[owner]};
    window.unexpected=[];
    window.fetch=async(url,init={})=>{
      const method=init.method??'GET';
      const json=(body,status=200)=>new Response(JSON.stringify(body),{status,headers:{'content-type':'application/json'}});
      if(url==='/api/upload-policy'&&method==='GET')return json({maxUploadMb:30,guestMaxUploadMb:10,maxImageUploadMb:10,maxBoardBackgroundMb:10,maxQuizImageMb:8,maxQuizImageStorageMb:256});
      if(url==='/api/boards/fixture/invite-links?page=1'&&method==='GET')return json({inviteLinks:[],page:1,totalCount:0});
      if(url==='/api/boards/fixture/access-requests'&&method==='GET')return json({requests:window.resolved?[]:[{id:'request',status:'PENDING',createdAt:'2026-09-17T00:00:00.000Z',updatedAt:'2026-09-17T00:00:00.000Z',user:applicant}],page:1,totalCount:window.resolved?0:1});
      if(url==='/api/boards/fixture/access-requests'&&method==='PATCH'){
        const body=JSON.parse(init.body);
        if(body.requestId!=='request'||!['APPROVE','REJECT'].includes(body.action))throw Error('Unexpected decision');
        if(window.failDecision)return json({error:'요청을 처리할 권한이 없습니다.'},403);
        window.resolved=true;window.approved=body.action==='APPROVE';
        return json({ok:true});
      }
      if(url==='/api/boards/fixture/members?page=1'&&method==='GET'){
        window.memberReads++;
        const members=window.approved?[owner,{role:'MEMBER',user:applicant}]:[owner];
        if(window.holdMembers)await new Promise(resolve=>window.releaseMembers=()=>{window.holdMembers=false;resolve();});
        return json({members,page:1,totalCount:members.length});
      }
      window.unexpected.push(method+' '+url);throw Error('Unexpected request: '+url);
    };
    window.render=(config={})=>{
      window.resolved=false;window.approved=false;window.memberReads=0;window.releaseMembers=undefined;window.holdMembers=Boolean(config.holdMembers);window.failDecision=Boolean(config.failDecision);
      root.render(<AppDialogProvider key={++sequence}><PadSettingsTabs
        board={board} isOwner frozen={false} titleDraft="설정 검증" descriptionDraft=""
        appearanceDraft={{layout:'WALL',sortMode:'MANUAL',newPostPlacement:'END',backgroundColor:'#F4F2EB',accentColor:'#315F44',font:'SANS',backgroundImageUrl:null}}
        fieldConfigDraft={defaultPostFieldConfig}
        participationDraft={{allowMemberPosting:true,allowMemberFileUpload:true,allowComments:true,allowReactions:true}}
        reactionPolicyDraft="SINGLE" downloadPolicyDraft="READERS" moderationModeDraft="NONE" freezeAtDraft=""
        onTitleChange={noop} onDescriptionChange={noop} onAppearanceChange={noop} onBackgroundImageChange={noop}
        onFieldConfigChange={noop} onApplyFieldConfig={noop} onParticipationChange={noop} onReactionPolicyChange={noop}
        onDownloadPolicyChange={noop} onModerationModeChange={noop} onFreezeAtChange={noop} onToggleFreeze={noop}
        onInviteMember={noop} onChangeMemberRole={noop} onRemoveMember={noop}
      /></AppDialogProvider>);
    };
  ` },
  absWorkingDir: root, bundle: true, write: false, outdir: "/tmp/pyxis-pad-settings-members-bundle", format: "iife", jsx: "automatic",
  define: { "process.env.NODE_ENV": '"production"' },
  plugins: [{ name: "next-image-adapter", setup(builder) {
    builder.onResolve({ filter: /^next\/image$/ }, () => ({ path: "next/image", namespace: "adapter" }));
    builder.onLoad({ filter: /.*/, namespace: "adapter" }, () => ({ contents: "export default function Image({fill,priority,unoptimized,...props}){return <img {...props}/>}", loader: "tsx", resolveDir: root }));
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
    ? route.fulfill({ contentType: "text/html", body: '<!doctype html><html lang="ko"><head><meta name="viewport" content="width=device-width,initial-scale=1"></head><body><div id="root"></div></body></html>' })
    : route.abort());
  await page.goto("http://fixture.local/");
  await page.addStyleTag({ content: css });
  for (const file of bundle.outputFiles) {
    if (file.path.endsWith(".css")) await page.addStyleTag({ content: file.text });
    if (file.path.endsWith(".js")) await page.addScriptTag({ content: file.text });
  }
  const memberTab = page.getByRole("tab", { name: /^멤버/ });
  const shareTab = page.getByRole("tab", { name: /^공개·공유/ });
  const members = page.locator(".members-settings");
  const applicantMember = members.locator("article").filter({ hasText: "신청자" });
  const request = page.getByRole("region", { name: "접근 요청", exact: true });
  async function render(config = {}) {
    await page.evaluate((config) => window.render(config), config);
    await page.getByRole("textbox", { name: "패드 이름" }).waitFor();
    await page.waitForFunction(() => document.querySelector('.access-request-settings .request-approve'));
  }
  for (const width of [1280, 390]) {
    await page.setViewportSize({ width, height: 900 });
    await render();
    await shareTab.click();
    assert.equal(await request.count(), 0, "공개·공유에는 접근 요청이 표시되지 않음");
    assert(await page.getByRole("button", { name: "멤버용 링크 만들기" }).isVisible(), "초대 링크는 공개·공유 유지");
    await memberTab.click();
    await request.waitFor();
    assert(await request.evaluate((el) => Boolean(el.compareDocumentPosition(document.querySelector('.members-settings')) & Node.DOCUMENT_POSITION_FOLLOWING)), "접근 요청이 참여 멤버보다 앞에 있음");
    await page.waitForFunction(() => window.memberReads === 1 && !document.querySelector('.members-settings .spin'));
    await request.getByRole("button", { name: "신청자 접근 승인" }).click();
    await applicantMember.waitFor();
    assert.equal(await request.getByRole("button").count(), 0, "승인한 요청 제거");
    await shareTab.click();
    await memberTab.click();
    assert(await applicantMember.isVisible(), "탭 왕복 후 새 멤버 유지");
    console.log(`PASS: ${width}px 멤버 탭 접근 요청·승인 후 목록 갱신·초대 링크 위치`);
  }

  await render({ holdMembers: true });
  await memberTab.click();
  await page.waitForFunction(() => typeof window.releaseMembers === 'function');
  await request.getByRole("button", { name: "신청자 접근 승인" }).click();
  await request.getByText("대기 중인 접근 요청이 없습니다.").waitFor();
  await page.evaluate(() => window.releaseMembers());
  await applicantMember.waitFor();
  console.log("PASS: 멤버 조회 중 승인해도 최신 목록 갱신을 놓치지 않음");

  await render({ failDecision: true });
  await memberTab.click();
  await request.getByRole("button", { name: "신청자 접근 승인" }).click();
  await request.getByText("요청을 처리할 권한이 없습니다.").waitFor();
  assert.equal(await applicantMember.count(), 0, "승인 실패 시 멤버로 표시하지 않음");
  assert(await request.getByRole("button", { name: "신청자 접근 승인" }).isVisible(), "실패한 요청 유지");
  console.log("PASS: 승인 실패 시 안내·요청 목록 보존");

  await render();
  await memberTab.click();
  await request.getByRole("button", { name: "신청자 접근 거절" }).click();
  await request.getByText("대기 중인 접근 요청이 없습니다.").waitFor();
  assert.equal(await applicantMember.count(), 0, "거절한 사용자는 멤버에 추가하지 않음");
  assert.deepEqual(await page.evaluate(() => window.unexpected), []);
  assert.deepEqual(errors, []);
  console.log("PASS: 거절 처리·브라우저 오류 없음");
} finally {
  await browser.close();
}
