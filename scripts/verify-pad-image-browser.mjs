import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { build } from "esbuild";
import sharp from "sharp";
const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT_MODULE_PATH || "playwright");
const adapters = {
  "next/dynamic": "import {lazy,Suspense} from 'react';export default load=>{const C=lazy(()=>load().then(m=>({default:m.default??m})));return p=><Suspense fallback={null}><C {...p}/></Suspense>}",
  "next/navigation": "export const useRouter=()=>({push(){},refresh(){}});export const useParams=()=>({slug:'fixture'});",
  "next/link": "export default ({href,children,...p})=><a href={href} {...p}>{children}</a>",
};
const bundle = await build({ stdin:{contents:`
import {useState} from 'react';import {createRoot} from 'react-dom/client';
import {PostComposer} from '@/components/pad/post-composer';
import {AttachmentViewer} from '@/components/pad/attachments/attachment-viewer';
import {PostBody} from '@/components/pad/post-body';
import {AppDialogProvider} from '@/components/ui/app-dialog';
import {defaultPostFieldConfig} from '@/lib/post-fields/defaults';
import {applyBoardEventDelta} from '@/components/pad/reconcile-sections';
import {storedAttachmentBlock} from '@/components/pad/post-content-blocks';
function App(){const [open,setOpen]=useState(true);const [post,setPost]=useState(null);
window.convert=()=>setPost(current=>{
const a={...current.attachments[0],mimeType:'image/webp',originalName:'photo.webp',imageRevision:1};
const sections=[{id:'s',posts:[current]}];
return applyBoardEventDelta(sections,{type:'attachment.updated',postId:current.id,entityId:a.id,payload:{attachment:a,attachmentPatch:a}},'END',null)[0].posts[0];
});
return <AppDialogProvider>{open&&<PostComposer open sectionId="s" sectionTitle="fixture" presentation="inline"
fieldConfig={{...defaultPostFieldConfig,body:{...defaultPostFieldConfig.body,visible:false}}}
onClose={()=>setOpen(false)} onSaved={p=>setPost(p)}/>}{post&&<><h2>게시 완료</h2>
<section aria-label="카드 첨부"><AttachmentViewer attachments={post.attachments}/></section>
<section aria-label="본문 첨부"><PostBody body={storedAttachmentBlock(post.attachments[0])} attachments={post.attachments}/></section>
</>}</AppDialogProvider>}
createRoot(document.getElementById('root')).render(<App/>);
`,loader:"tsx",resolveDir:process.cwd()},bundle:true,write:false,outdir:"/tmp/pad-image-browser-bundle",format:"iife",jsx:"automatic",
define:{"process.env.NODE_ENV":'"production"'},plugins:[{name:"browser-adapters",setup(b){
  b.onResolve({filter:/.*/},a=>Object.hasOwn(adapters,a.path)?{path:a.path,namespace:"fixture"}:undefined);
  b.onLoad({filter:/.*/,namespace:"fixture"},a=>({contents:adapters[a.path],loader:"tsx",resolveDir:process.cwd()}));
}}] });
const browser = await chromium.launch({headless:true});
try {
  const page = await browser.newPage({viewport:{width:900,height:900}});
  page.setDefaultTimeout(10000);
  const errors=[];page.on("pageerror",e=>errors.push(e.message));
  const jpeg=await sharp({create:{width:16,height:12,channels:3,background:"red"}}).jpeg().toBuffer();
  const webp=await sharp(jpeg).webp().toBuffer();
  const attachment={id:"a",type:"IMAGE",originalName:"photo.jpg",mimeType:"image/jpeg",fileSize:jpeg.length,width:16,height:12,imageRevision:0};
  const post={id:"p",version:1,body:"",attachments:[attachment],author:{id:"fixture"}};
  let uploaded=false;let finalized=false;
  await page.route("https://fixture.local/**",async route=>{
    const url=new URL(route.request().url());
    const json=body=>route.fulfill({contentType:"application/json",body:JSON.stringify(body)});
    if(url.pathname==="/api/upload-policy")return json({});
    if(url.pathname==="/api/sections/s/posts")return json({post:{...post,attachments:[]}});
    if(url.pathname==="/api/posts/p/attachments"){uploaded=true;return json({attachment});}
    if(url.pathname==="/api/posts/p"){assert(uploaded);finalized=true;return json({post});}
    if(url.pathname==="/f/a")return route.fulfill({contentType:url.searchParams.get("v")==="1"?"image/webp":"image/jpeg",body:url.searchParams.get("v")==="1"?webp:jpeg});
    return route.fulfill({contentType:"text/html",body:'<div id="root"></div>'});
  });
  await page.goto("https://fixture.local");
  for(const output of bundle.outputFiles) {
    if(output.path.endsWith(".js"))await page.addScriptTag({content:output.text});
    if(output.path.endsWith(".css"))await page.addStyleTag({content:output.text});
  }
  await page.locator('input[type="file"]').first().setInputFiles({name:"photo.jpg",mimeType:"image/jpeg",buffer:jpeg});
  await page.getByRole("list",{name:"첨부 파일 1개",exact:true}).waitFor();
  await page.getByRole("button",{name:"게시하기",exact:true}).click();
  await page.getByRole("heading",{name:"게시 완료"}).waitFor();
  assert(finalized);
  const picture=page.getByRole("region",{name:"카드 첨부"}).locator("img");
  assert.match(await picture.getAttribute("src"),/v=0/);
  await page.evaluate(()=>window.convert());
  await page.waitForFunction(()=>document.querySelector('[aria-label="카드 첨부"] img')?.getAttribute("src")?.includes("v=1"));
  assert.match(await page.getByRole("region",{name:"본문 첨부"}).locator("img").getAttribute("src"),/v=1/);
  assert.deepEqual(errors,[]);
  console.log("pad_image_browser=passed actual_composer=posted_before_conversion image_revision=refetched");
} finally {await browser.close();}
