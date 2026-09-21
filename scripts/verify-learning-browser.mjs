import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { build } from "esbuild";

const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT_MODULE_PATH || "playwright");
// 실제 서버 컴포넌트/카드/자동 갱신을 실행하고, Next 전송 계층과 DB 조회만 대체합니다.
const result = await build({ stdin: { contents: `
  import {createRoot} from 'react-dom/client';
  import {StudentDashboard} from '@/components/learning/student-dashboard';
  import {ContentCard} from '@/components/ui/content-card';
  const root=createRoot(document.getElementById('root'));
  window.renderDashboard=async()=>{
    const params=new URLSearchParams(location.search);
    const dashboard=await StudentDashboard({user:{id:'student',name:'학생'},subjectId:params.get('subjectId')||undefined,kind:params.get('kind')||undefined,page:Number(params.get('page')||1)});
    root.render(<><section aria-label="기존 공용 카드"><ContentCard title="기존 목록 카드" href="/reference" description="기존 카드와 비교" badges="패드" metadata="수업" footerLabel="패드" footerAction="열기" menu={{open:false,onOpenChange:()=>{},children:'수정'}} /></section>{dashboard}</>);
  };
  window.navigate=href=>{history.pushState(null,'',href);window.renderDashboard();};
  window.addEventListener('popstate',()=>window.renderDashboard());
  await window.renderDashboard();
`, loader: "tsx", resolveDir: process.cwd() }, bundle: true, write: false, format: "esm", jsx: "automatic", outfile: "learning-test.js", loader: { ".module.css": "local-css" },
  define: { "process.env.NODE_ENV": '"production"' },
  plugins: [{ name: "next-boundaries", setup(b) {
    b.onResolve({ filter: /^next\/link$/ }, () => ({ path: "link", namespace: "fixture" }));
    b.onResolve({ filter: /^next\/navigation$/ }, () => ({ path: "navigation", namespace: "fixture" }));
    b.onResolve({ filter: /^@\/lib\/learning\/queries$/ }, () => ({ path: "queries", namespace: "fixture" }));
    b.onLoad({ filter: /.*/, namespace: "fixture" }, ({ path }) => ({ contents: path === "link"
      ? `export default function Link({href,children,prefetch,scroll,...props}){return <a href={href} {...props} onClick={e=>{if(href.startsWith('/dashboard')){e.preventDefault();window.navigate(href);}}}>{children}</a>}`
      : path === "navigation" ? `const router={refresh(){window.learningRefreshes=(window.learningRefreshes||0)+1;window.renderDashboard();}};export const useRouter=()=>router;export const notFound=()=>{throw new Error('NOT_FOUND')};`
      : `export const getLearningCourses=async()=>[{id:'science',name:'과학',canManage:false},{id:'math',name:'수학',canManage:false}];
         export const getCourseAccess=async id=>['science','math'].includes(id)?{id}:null;
         export const getLearningPage=async(user,{kind,subjectId,page=1,pageSize})=>{
           const prefix=subjectId||'전체현황';
           const live=kind==='quiz'&&subjectId==='science'&&window.liveOpen;
           const item={id:kind,title:prefix+' '+kind+' '+page,description:'수업 활동',subjectName:subjectId||'과학',status:'참여 중',action:live?'라이브 참여':'바로 열기',href:live?'/j/123456?subjectId=science':({quiz:'/p/session',pad:'/b/board',form:'/s/survey'})[kind]};
           return {kind,total:subjectId?50:1,page,pageSize,totalPages:subjectId?3:1,items:subjectId?[item,{id:kind+'-closed',title:'아주긴제목'.repeat(30),description:'아주긴설명'.repeat(30),subjectName:'과학',status:'마감',action:'열기',href:null}]:[item]};
         };`, loader: "tsx", resolveDir: process.cwd() }));
  } }],
});
const css = (await require("postcss")([require("@tailwindcss/postcss")()]).process(readFileSync("app/globals.css", "utf8"), { from: "app/globals.css" })).css;
const script=result.outputFiles.find(f=>f.path.endsWith('.js')).text;
const moduleCss=result.outputFiles.find(f=>f.path.endsWith('.css')).text;
const browser = await chromium.launch({ headless: true });
try {
  for (const width of [390, 1280]) {
    const page = await browser.newPage({ viewport: { width, height: 850 } });
    page.setDefaultTimeout(10000);
    const errors=[];
    page.on('pageerror',e=>errors.push(e.message));
    await page.route('**/*',route=>{
      assert.equal(new URL(route.request().url()).pathname,'/dashboard','클라이언트에서 관리 API를 요청하지 않습니다.');
      return route.fulfill({contentType:'text/html',body:`<html><head><meta name="viewport" content="width=device-width,initial-scale=1"><style>${css}\n${moduleCss}</style></head><body><div id="root"></div><script type="module">${script}</script></body></html>`});
    });
    await page.clock.install();
    await page.goto('http://fixture.local/dashboard');
    await page.getByRole('heading',{name:'내 교과목'}).waitFor();
    assert.equal(await page.locator('main article').count(),3);
    assert.equal(await page.getByText('참여 중인 퀴즈·패드·설문으로 바로 이동하세요.').count(),0);
    const courseNav=page.getByRole('navigation',{name:'교과목 필터'});
    await courseNav.getByRole('link',{name:/과학/}).click();
    await page.getByRole('heading',{name:'science pad 1',exact:true}).waitFor();
    assert.equal(new URL(page.url()).search,'?subjectId=science');
    assert.equal(await page.getByRole('dialog').count(),0);
    assert.equal(await courseNav.getByRole('link',{name:/과학/}).getAttribute('aria-current'),'true');
    for(const kind of ['quiz','pad','form']) assert.equal(await page.getByRole('heading',{name:`science ${kind} 1`,exact:true}).count(),1);
    assert.equal(await page.locator('main article').nth(1).getByRole('link').count(),0,'마감 카드는 링크를 만들지 않습니다.');
    assert.equal(await page.locator('main button[aria-haspopup="menu"]').count(),0);
    const style=el=>{const s=getComputedStyle(el);return {radius:s.borderRadius,background:s.backgroundColor,minHeight:s.minHeight};};
    assert.deepEqual(await page.locator('main article').first().evaluate(style),await page.getByRole('region',{name:'기존 공용 카드'}).locator('article').evaluate(style));
    assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),'긴 제목도 모바일 가로 스크롤을 만들지 않습니다.');
    if(width===1280) assert(await page.locator('main article').first().evaluate(el=>el.getBoundingClientRect().width<500));
    await page.evaluate(()=>{window.liveOpen=true;window.learningRefreshes=0;});
    await page.clock.fastForward(15001);
    await page.getByRole('link',{name:'라이브 참여',exact:true}).waitFor();
    assert.equal(await page.getByRole('link',{name:'라이브 참여',exact:true}).getAttribute('href'),'/j/123456?subjectId=science');
    assert.equal(await page.evaluate(()=>window.learningRefreshes),1);
    await page.getByRole('navigation',{name:'활동 종류'}).getByRole('link',{name:'패드',exact:true}).click();
    await page.getByRole('navigation',{name:'페이지 탐색'}).waitFor();
    assert.equal(await page.getByRole('heading',{name:'science quiz 1',exact:true}).count(),0);
    await page.getByRole('link',{name:'2페이지',exact:true}).click();
    await page.getByRole('heading',{name:'science pad 2',exact:true}).waitFor();
    assert.equal(new URL(page.url()).search,'?subjectId=science&kind=pad&page=2');
    await page.reload();
    await page.getByRole('heading',{name:'science pad 2',exact:true}).waitFor();
    await courseNav.getByRole('link',{name:/수학/}).click();
    await page.getByRole('heading',{name:'math quiz 1',exact:true}).waitFor();
    await page.goBack();
    await page.getByRole('heading',{name:'science pad 2',exact:true}).waitFor();
    await courseNav.getByRole('link',{name:/전체 과목/}).click();
    await page.getByRole('heading',{name:'전체현황 form 1',exact:true}).waitFor();
    assert.equal(new URL(page.url()).search,'');
    assert.equal(await page.locator('main article').count(),3);
    assert.deepEqual(errors,[]);
    await page.close();
  }
  console.log('PASS: 모달 없는 과목 필터, 공용 카드/모바일, 종류·페이지·새로고침·뒤로가기, 라이브 자동 갱신');
} finally { await browser.close(); }
