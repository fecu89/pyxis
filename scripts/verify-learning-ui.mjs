// 실제 공용 카드/학생 목록의 서버 렌더링 계약: CSS와 Next Link 경계만 대체합니다.
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { test } from "node:test";
import { build } from "esbuild";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

const require = createRequire(import.meta.url);
const bundle = await build({ stdin: { contents: `
  export {ContentCard} from '@/components/ui/content-card';
  export {LearningItems} from '@/components/learning/learning-items';
`, resolveDir: process.cwd() }, bundle: true, write: false, platform: "node", format: "cjs", packages: "external",
  plugins: [{ name: "render-boundaries", setup(b) {
    b.onResolve({ filter: /^next\/link$/ }, () => ({ path: "link", namespace: "fixture" }));
    b.onLoad({ filter: /.*/, namespace: "fixture" }, () => ({ contents: "import {createElement} from 'react'; export default function Link({href,prefetch,children,...props}) { return createElement('a',{href,...props},children); }", resolveDir: process.cwd() }));
    b.onLoad({ filter: /\.css$/ }, () => ({ contents: "export default {};", loader: "js" }));
  } }],
});
const loaded = { exports: {} };
new Function("require", "module", "exports", bundle.outputFiles[0].text)(require, loaded, loaded.exports);
const { ContentCard, LearningItems } = loaded.exports;

test("관리 메뉴가 없는 공용 카드는 빈 더보기 버튼을 만들지 않는다", () => {
  const html = renderToStaticMarkup(createElement(ContentCard, { title: "학생 퀴즈", href: "/p/session", description: "과학", badges: "새 과제", metadata: "과학", footerLabel: "퀴즈", footerAction: "시작" }));
  assert(!html.includes("<button"), "관리 액션 없는 학생 카드에는 더보기 버튼이 없어야 합니다.");
  assert(html.includes('href="/p/session"'));
});

test("학생 목록은 공용 카드의 독립된 실행 버튼을 제공하고 마감 과제는 링크를 만들지 않는다", () => {
  const html = renderToStaticMarkup(createElement(LearningItems, { data: { kind: "quiz", total: 2, page: 1, pageSize: 24, totalPages: 1, items: [
    { id: "open", title: "새 퀴즈", href: "/p/session", description: "과학 수업", subjectName: "과학", status: "새 과제", action: "퀴즈 시작" },
    { id: "closed", title: "마감 퀴즈", href: null, description: null, subjectName: "과학", status: "마감", action: "퀴즈 시작" },
  ] } }));
  assert.equal((html.match(/<article/g) || []).length, 2);
  assert.equal((html.match(/href="\/p\/session"/g) || []).length, 2, "카드 본문과 하단 실행 링크를 분리합니다.");
  assert(!html.includes("<button"));
  assert(!html.includes('href="#"') && !html.includes('href=""'));
});

test("같은 퀴즈의 라이브와 과제는 모드 배지와 독립된 참여 경로로 구별한다", () => {
  const item = { title: "같은 퀴즈", description: null, subjectName: "과학", status: "진행 중" };
  const html = renderToStaticMarkup(createElement(LearningItems, { data: { kind: "quiz", total: 2, page: 1, pageSize: 24, totalPages: 1, items: [
    { ...item, id: "live:1", mode: "LIVE", action: "라이브 참여", href: "/j/123456?subjectId=science" },
    { ...item, id: "assignment:1", mode: "ASYNC", action: "과제 풀기", href: "/p/async" },
  ] } }));
  assert(html.includes("라이브") && html.includes("자율 풀이 과제"));
  assert(html.includes('href="/j/123456?subjectId=science"') && html.includes('href="/p/async"'));
});
