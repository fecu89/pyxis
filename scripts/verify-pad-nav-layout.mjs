// 실제 globals.css를 Chromium에서 검사합니다. DOM fixture는 PadCanvas/AppShell의
// 레이아웃 경계와 전체 상단 도구를 재현하며 서버·DB를 변경하지 않습니다.
// PLAYWRIGHT_MODULE_PATH=/path/to/playwright node scripts/verify-pad-nav-layout.mjs
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT_MODULE_PATH || "playwright");
const cssPath = fileURLToPath(new URL("../app/globals.css", import.meta.url));
const css = (await require("postcss")([require("@tailwindcss/postcss")()])
  .process(readFileSync(cssPath, "utf8"), { from: cssPath })).css;
const icon = (size) => `<svg width="${size}" height="${size}" aria-hidden="true"></svg>`;
const markup = `
  <div class="zone-frame"><div class="app-shell"><div class="app-shell-content">
    <main class="board-page">
      <header class="board-nav">
        <a class="back-link" href="#">${icon(18)}${icon(22)}<b>pyxis</b></a>
        <div class="board-nav-center">
          <span class="board-nav-scope">${icon(14)}</span>
          <span class="board-nav-title">${"확대 축소 후에도 유지할 긴 패드 제목 ".repeat(6)}</span>
          <span class="board-nav-owner">패드 관리자</span>
        </div>
        <div class="board-nav-actions">
          <span class="sync-state online">${icon(15)}</span>
          <button class="icon-button" aria-label="테마">${icon(18)}</button>
          <div class="notification-bell"><button class="icon-button" aria-label="알림">${icon(18)}</button></div>
          <div class="board-toolbar-group">
            <button class="board-toolbar-item" aria-label="패드 공유">${icon(16)}<span class="board-toolbar-label">공유</span></button>
            <div class="board-toolbar-more-wrap"><button class="board-toolbar-item board-toolbar-more" aria-label="더보기">${icon(18)}</button></div>
            <button class="board-toolbar-item" aria-label="패드 설정">${icon(18)}</button>
          </div>
        </div>
      </header>
      <div class="pad-canvas">
        ${Array.from({ length: 12 }, (_, index) => `
          <section class="section-column" id="section-${index}">
            <header class="section-header"><div><h2>${index + 1}. ${"아주 긴 섹션 제목 ".repeat(6)}</h2></div></header>
            <div class="post-list"><article class="post-card"><div class="post-card-copy"><h3>게시물</h3><div class="markdown-body"><p>${"긴 내용 ".repeat(100)}</p></div></div></article></div>
          </section>`).join("")}
      </div>
    </main>
  </div></div></div>`;

const browser = await chromium.launch({ headless: true });
try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.setContent(`<meta name="viewport" content="width=device-width,initial-scale=1">${markup}`);
  await page.addStyleTag({ content: css });

  async function verifyBounds(label, titleShouldScroll = true) {
    const metrics = await page.evaluate(() => {
      const nav = document.querySelector(".board-nav").getBoundingClientRect();
      const center = document.querySelector(".board-nav-center");
      const actions = document.querySelector(".board-nav-actions").getBoundingClientRect();
      const canvas = document.querySelector(".pad-canvas");
      const viewport = document.documentElement.clientWidth;
      const buttons = [...document.querySelectorAll(".board-toolbar-group button")].map((button) => {
        const rect = button.getBoundingClientRect();
        const hit = document.elementFromPoint(rect.x + rect.width / 2, rect.y + rect.height / 2);
        return { label: button.getAttribute("aria-label"), left: rect.left, right: rect.right, hittable: button.contains(hit) };
      });
      return {
        viewport, documentWidth: document.documentElement.scrollWidth,
        navWidth: nav.width, navLeft: nav.left,
        centerRight: center.getBoundingClientRect().right, actionsLeft: actions.left,
        titleScrollable: center.scrollWidth > center.clientWidth,
        canvasScrollable: canvas.scrollWidth > canvas.clientWidth,
        canvasWidth: canvas.getBoundingClientRect().width,
        sectionOverflow: [...document.querySelectorAll(".post-list")].some((el) => el.scrollWidth > el.clientWidth + 1),
        buttons,
      };
    });
    const context = `${label}: ${JSON.stringify(metrics)}`;
    assert(metrics.documentWidth <= metrics.viewport + 1, `페이지 전체가 가로로 넘침: ${context}`);
    assert(Math.abs(metrics.navWidth - metrics.viewport) <= 1 && Math.abs(metrics.navLeft) <= 1, context);
    assert(metrics.centerRight <= metrics.actionsLeft + 1, `제목이 도구를 덮음: ${context}`);
    assert.equal(metrics.titleScrollable, titleShouldScroll, `제목 스크롤 영역: ${context}`);
    assert(metrics.canvasScrollable && metrics.canvasWidth <= metrics.viewport + 1, context);
    assert(!metrics.sectionOverflow, `섹션 내부 가로 스크롤: ${context}`);
    assert(metrics.buttons.every((button) => button.left >= 0 && button.right <= metrics.viewport + 1 && button.hittable), context);
  }

  // 브라우저 확대/축소가 레이아웃에 전달하는 viewport 폭 변화와 980px 경계 왕복.
  for (const width of [1280, 980, 640, 320, 640, 980, 981, 1280, 1920, 1280, 390, 320, 390, 1280]) {
    await page.setViewportSize({ width, height: 900 });
    await verifyBounds(`width=${width}`);
    // 섹션을 끝까지 스크롤해도 내비게이션은 같은 위치에 있어야 합니다.
    await page.locator(".pad-canvas").evaluate((element) => { element.scrollLeft = element.scrollWidth; });
    await verifyBounds(`width=${width}, sections=end`);
    await page.locator(".board-nav-center").evaluate((element) => { element.scrollLeft = element.scrollWidth; });
    await verifyBounds(`width=${width}, title=end`);
  }

  // 핀치 확대 뒤 원래 배율로 돌아왔을 때 문서 폭이나 스크롤 오프셋이 남지 않아야 합니다.
  const cdp = await page.context().newCDPSession(page);
  for (const width of [390, 1280]) {
    await page.setViewportSize({ width, height: 900 });
    await cdp.send("Emulation.setPageScaleFactor", { pageScaleFactor: 2 });
    await cdp.send("Emulation.setPageScaleFactor", { pageScaleFactor: 1 });
    await verifyBounds(`pinch-reset=${width}`);
  }
  await page.locator(".board-nav-title").evaluate((element) => { element.textContent = "패드"; });
  await page.locator(".board-nav-owner").evaluate((element) => { element.textContent = "교사"; });
  for (const width of [1280, 980, 390, 1280]) {
    await page.setViewportSize({ width, height: 900 });
    await verifyBounds(`short-title=${width}`, false);
  }
  assert.deepEqual(errors, []);
  console.log("PASS Pad 상단바: 320–1920px 왕복, 핀치 확대 복귀, 긴 제목, 12개 섹션 가로 스크롤, 공유·설정 클릭 영역");
} finally {
  await browser.close();
}
