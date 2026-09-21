import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const root = fileURLToPath(new URL("..", import.meta.url));
const { chromium } = require(process.env.PLAYWRIGHT_MODULE_PATH || "playwright");
const { outputFiles } = await require("esbuild").build({
  stdin: { contents: `
    import {createRoot, hydrateRoot} from 'react-dom/client';
    import {renderToString} from 'react-dom/server';
    import {Avatar} from '@/components/ui/avatar';
    const root = createRoot(document.getElementById('root'));
    window.renderAvatars = (image = "http://img1.kakaocdn.net/broken.jpg") => root.render(<>
      <Avatar image="http://img1.kakaocdn.net/profile-fixture.jpg" name="김검증"/>
      <Avatar image="http://k.kakaocdn.net/profile-fixture.jpg" name="이검증"/>
      <Avatar image="/api/users/fixture/avatar" name="박검증"/>
      <Avatar name="최검증"/>
      <section id="fallback"><Avatar image={image} name="정검증" size="medium"/></section>
    </>);
    window.renderAvatars();
    const ssrAvatar = <Avatar image="http://img1.kakaocdn.net/ssr-broken.jpg" name="서검증"/>;
    window.serverAvatarHTML = () => renderToString(ssrAvatar);
    window.hydrateAvatar = () => hydrateRoot(document.getElementById('ssr'), ssrAvatar);
  `, loader: "tsx", resolveDir: root },
  absWorkingDir: root, bundle: true, write: false, jsx: "automatic", format: "iife",
  define: { "process.env.NODE_ENV": '"production"' },
});

const browser = await chromium.launch({ headless: true });
try {
  const page = await browser.newPage();
  const warnings = [], errors = [];
  page.on("console", message => { if (message.text().includes("Mixed Content")) warnings.push(message.text()); });
  page.on("pageerror", error => errors.push(error.message));
  // 실제 Avatar를 HTTPS 문서에서 실행하고 이미지 응답만 메모리로 대체합니다.
  const imageRequests = [];
  await page.route("**/*", route => {
    if (route.request().resourceType() !== "image") return route.fulfill({ contentType: "text/html", body: '<div id="root"></div>' });
    imageRequests.push(route.request().url());
    if (route.request().url().includes("broken.jpg")) return route.fulfill({ status: 404, body: "not found" });
    return route.fulfill({ contentType: "image/png", body: Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+afooAAAAASUVORK5CYII=", "base64") });
  });
  await page.goto("https://profile-fixture.example.org/");
  await page.addScriptTag({ content: outputFiles[0].text });
  await page.locator("#fallback span.avatar.medium").waitFor({ timeout: 5000 });
  assert.equal(await page.locator("#fallback").textContent(), "정", "깨진 사진 대신 기본 아바타");
  await page.waitForFunction(() => document.images.length === 3 && [...document.images].every(image => image.complete && image.naturalWidth > 0));
  assert.deepEqual(warnings, [], "HTTP 프로필을 표시해도 브라우저 자동 승격 경고가 없어야 합니다.");
  assert.deepEqual(await page.locator("img").evaluateAll(images => images.map(image => image.getAttribute("src"))), [
    "https://img1.kakaocdn.net/profile-fixture.jpg",
    "https://k.kakaocdn.net/profile-fixture.jpg",
    "/api/users/fixture/avatar",
  ]);
  assert.equal(await page.locator("#root > span.avatar").textContent(), "최");
  await page.evaluate(() => window.renderAvatars("/api/users/fixture/replaced-avatar"));
  await page.waitForFunction(() => document.querySelector("#fallback img")?.naturalWidth > 0);
  assert.equal(await page.locator("#fallback img").getAttribute("src"), "/api/users/fixture/replaced-avatar", "이미지 변경 시 다시 표시");
  await page.evaluate(() => {
    const container = document.createElement("section");
    container.id = "ssr";
    container.innerHTML = window.serverAvatarHTML();
    document.body.append(container);
  });
  await page.waitForFunction(() => {
    const image = document.querySelector("#ssr img");
    return image?.complete && image.naturalWidth === 0;
  });
  await page.evaluate(() => window.hydrateAvatar());
  await page.locator("#ssr span.avatar").waitFor({ timeout: 5000 });
  assert.equal(await page.locator("#ssr span.avatar").textContent(), "서", "hydration 전에 실패해도 기본 아바타로 전환");
  assert.ok(imageRequests.every(url => url.startsWith("https:")), "HTTP로 재시도하지 않음");
  assert.deepEqual(warnings, []);
  assert.deepEqual(errors, []);
  console.log("PASS 프로필 이미지: HTTPS 표시, Mixed Content 경고 없음, 실패 시 기본 아바타, 이미지 변경 시 복구");
} finally {
  await browser.close();
}
