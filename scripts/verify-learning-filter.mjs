import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { test } from 'node:test';
import { build } from 'esbuild';
import { renderToStaticMarkup } from 'react-dom/server';

const require = createRequire(import.meta.url);
const state = { calls: [] };
globalThis.learningFilterTest = state;
const result = await build({ stdin: { contents: `export {StudentDashboard} from './components/learning/student-dashboard';`, resolveDir: process.cwd() }, bundle: true, write: false, platform: 'node', format: 'cjs', packages: 'external',
  plugins: [{ name: 'server-boundaries', setup(b) {
    b.onResolve({ filter: /^@\/lib\/learning\/queries$/ }, () => ({ path: 'queries', namespace: 'fixture' }));
    b.onResolve({ filter: /^next\/navigation$/ }, () => ({ path: 'navigation', namespace: 'fixture' }));
    b.onLoad({ filter: /.*/, namespace: 'fixture' }, ({path}) => ({ contents: path === 'navigation'
      ? `export const useRouter=()=>({refresh(){}}); export const notFound=()=>{throw new Error('NOT_FOUND')};`
      : `export const getLearningCourses=async()=>[{id:'science',name:'과학',canManage:false}];
         export const getCourseAccess=async(id)=>id==='science'?{id,name:'과학',canManage:false}:null;
         export const getLearningPage=async(user,options)=>{globalThis.learningFilterTest.calls.push(options);return {kind:options.kind,total:50,page:options.page||1,pageSize:options.pageSize,totalPages:3,items:[{id:options.kind,title:(options.subjectId||'전체')+' '+options.kind,description:null,subjectName:null,status:'참여 중',action:'열기',href:'/activity/'+options.kind}]};};` }));
    b.onLoad({ filter: /\.css$/ }, () => ({ contents: 'export default {};', loader: 'js' }));
  } }],
});
const mod = {exports:{}};
new Function('require','module','exports',result.outputFiles[0].text)(require,mod,mod.exports);
const {StudentDashboard} = mod.exports;
const user = {id:'student',role:'STUDENT',status:'ACTIVE'};

test('과목 선택은 세 종류의 서버 조회와 전체 보기 링크에 유지된다', async () => {
  state.calls=[];
  const html=renderToStaticMarkup(await StudentDashboard({user,subjectId:'science'}));
  assert.deepEqual(state.calls.map(({kind,subjectId})=>({kind,subjectId})),[{kind:'quiz',subjectId:'science'},{kind:'pad',subjectId:'science'},{kind:'form',subjectId:'science'}]);
  for(const kind of ['quiz','pad','form']) assert(html.includes(`/dashboard?subjectId=science&amp;kind=${kind}`));
  assert(!html.includes('aria-haspopup="dialog"'));
  assert(!html.includes('참여 중인 퀴즈·패드·설문으로 바로 이동하세요.'));
  assert(html.includes('전체 과목'));
});
test('필터 전체 보기는 24개씩 조회하고 페이지 링크에서도 과목과 종류를 보존한다',async()=>{
  state.calls=[];
  const html=renderToStaticMarkup(await StudentDashboard({user,subjectId:'science',kind:'pad',page:2}));
  assert(state.calls.some(o=>o.kind==='pad'&&o.subjectId==='science'&&o.page===2&&o.pageSize===24));
  assert(html.includes('/dashboard?subjectId=science&amp;kind=pad&amp;page=3'));
  assert(!html.includes('/activity/quiz'));
  assert(!html.includes('/activity/form'));
});
test('권한 없는 과목 필터는 콘텐츠 조회 전에 거절한다',async()=>{
  state.calls=[];
  await assert.rejects(StudentDashboard({user,subjectId:'other'}),/NOT_FOUND/);
  assert.deepEqual(state.calls,[]);
});
test('전체 과목으로 돌아오면 과목 제한이 없는 세 목록을 보여준다',async()=>{
  state.calls=[];
  const html=renderToStaticMarkup(await StudentDashboard({user}));
  assert.equal(state.calls.length,3);
  assert(state.calls.every(o=>!o.subjectId));
  assert(html.includes('href="/dashboard?subjectId=science"'));
  for(const path of ['/quiz','/pad','/forms']) assert(html.includes(`href="${path}"`));
});
