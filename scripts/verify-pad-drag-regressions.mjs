import assert from "node:assert/strict";

// 실제 PadCanvas/DnD/작성기를 사용하고 네트워크 완료 시점만 fixture에서 제어합니다.
export async function verifyPadDragRegressions(page, render) {
  const failures = [];
  const card = page.locator('.section-column article[aria-label="게시물 열기: 테스트 게시물"]');
  const settle = () => page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  async function startMove(section) {
    const from = await card.locator(".post-card-copy").boundingBox();
    const to = await page.locator(`#section-section-${section} .post-list`).boundingBox();
    await page.mouse.move(from.x + 60, from.y + 18);
    await page.mouse.down();
    await page.mouse.move(from.x + 80, from.y + 18, { steps: 5 });
    await settle();
    await page.mouse.move(to.x + 90, to.y + 60, { steps: 20 });
    await settle();
  }
  async function drop(section) {
    await startMove(section);
    await page.mouse.up();
    // 제품의 250ms drop animation이 끝난 뒤 상태를 검사합니다.
    await page.waitForTimeout(400);
  }
  async function finish(index, options = {}) {
    await page.waitForFunction(index => Boolean(window.pendingMoves[index]), index);
    await page.evaluate(({ index, options }) => window.pendingMoves[index].finish(options), { index, options });
    await settle();
  }
  async function expectSection(section) {
    assert.equal(await card.evaluate(el => el.closest("section").id), `section-section-${section}`);
    assert.equal(await card.locator(".post-card-copy").textContent(), "테스트 게시물원래 본문");
  }
  async function test(name, run) {
    await render();
    await settle();
    try { await run(); console.log(`PASS ${name}`); }
    catch (error) { failures.push(`${name}: ${error.message}`); }
    finally { await page.mouse.up(); }
  }

  await test("이동 후 첫 클릭과 드래그 덮개 정리", async () => {
    await drop(1); await finish(0);
    await drop(0); await finish(1);
    await expectSection(0);
    assert.equal(await page.locator(".drag-overlay-card").count(), 0, "드롭 후 덮개가 남으면 안 됨");
    const hit = await card.locator(".post-card-copy").evaluate(el => {
      const rect = el.getBoundingClientRect();
      return el.contains(document.elementFromPoint(rect.x + 60, rect.y + 18));
    });
    assert(hit, "투명한 드래그 덮개가 카드 클릭을 가로채면 안 됨");
    await card.locator(".post-card-copy").click({ position: { x: 60, y: 18 } });
    assert.deepEqual(await page.evaluate(() => window.navigations), ["/b/fixture/posts/post"]);
  });

  await test("드래그 미리보기는 공간과 포인터 입력을 차지하지 않음", async () => {
    await startMove(1);
    assert.deepEqual(await page.locator(".drag-overlay-card").evaluate(el => {
      const style = getComputedStyle(el.parentElement);
      return { position: style.position, pointerEvents: style.pointerEvents };
    }), { position: "fixed", pointerEvents: "none" });
    await page.keyboard.press("Escape");
  });

  await test("연속 이동은 서버에 순서대로 저장하고 이전 SSE는 마지막 위치를 보존", async () => {
    await drop(1); await drop(0);
    assert.equal(await page.evaluate(() => window.pendingMoves.length), 1, "같은 카드의 저장 요청은 직렬화해야 함");
    await finish(0);
    await expectSection(0);
    await finish(1, { emit: false });
    await page.evaluate(() => window.emit(window.moveEvents[0]));
    await settle();
    await expectSection(0);
    await page.evaluate(() => window.emit(window.moveEvents[1]));
    await settle();
    await expectSection(0);
  });

  await test("새 드래그 중 이전 저장이 끝나도 위치와 취소 원점 보존", async () => {
    await drop(1); await startMove(0); await finish(0);
    await expectSection(0);
    await page.keyboard.press("Escape");
    await page.mouse.up(); await settle();
    await expectSection(1);
    assert.equal(await page.evaluate(() => window.pendingMoves.length), 1, "취소한 이동은 저장하지 않음");
  });

  await test("이전 이동 실패가 다음 이동을 되돌리지 않음", async () => {
    await drop(1); await drop(0);
    await finish(0, { fail: true });
    await expectSection(0);
    await finish(1);
    await expectSection(0);
  });

  await test("마지막 이동 실패는 서버 상태로 복구", async () => {
    await drop(1); await finish(0);
    await drop(0); await finish(1, { fail: true });
    await page.waitForFunction(() => window.calls.some(call => call.url.endsWith('/realtime-snapshot')));
    await settle(); await expectSection(1);
  });

  await test("이전 저장 실패 중 새 드래그를 취소해도 서버 위치로 복구", async () => {
    await drop(1); await startMove(0); await finish(0, { fail: true });
    // 드래그가 활성 상태인 동안 복구 스냅샷이 먼저 도착하는 순서도 검사합니다.
    await page.waitForTimeout(600);
    await page.keyboard.press("Escape"); await page.mouse.up();
    await page.waitForFunction(() => {
      const card = document.querySelector('.section-column article[aria-label="게시물 열기: 테스트 게시물"]');
      return card?.closest('section').id === 'section-section-0' && !card.classList.contains('dragging');
    });
    await expectSection(0);
  });

  await test("저장 응답보다 최신인 다른 사용자의 이동도 반영", async () => {
    await drop(1); await finish(0, { deferResponse: true });
    await page.evaluate(() => {
      const sections = window.fixture.board.sections;
      const post = sections[1].posts.pop();
      post.version = 3; sections[2].posts.push(post);
      sections[1].totalPostCount = 0; sections[2].totalPostCount = 1;
      window.emit({ type: 'post.reordered', entityId: 'post', sectionId: 'section-2', payload: {
        postMove: { sectionId: 'section-2', position: 1024, version: 3, previousItemId: null, nextItemId: null },
      } });
    });
    await settle(); await expectSection(1);
    await page.evaluate(() => window.delayedMoveResponse());
    await page.waitForFunction(() => document.querySelector('.section-column article[aria-label="게시물 열기: 테스트 게시물"]')?.closest('section').id === 'section-section-2');
    await expectSection(2);
  });

  await test("저장 중 재연결 스냅샷에서 확인한 다른 카드 삭제 보존", async () => {
    await page.evaluate(() => {
      const section = window.fixture.board.sections[0];
      const post = { ...section.posts[0], id: 'other-post', title: '삭제된 다른 글' };
      section.posts.push(post); section.totalPostCount += 1;
      window.emit({ type: 'post.created', entityId: post.id, sectionId: section.id, payload: { post } });
    });
    await settle(); await drop(1);
    const snapshotCount = await page.evaluate(() => window.calls.filter(call => call.url.endsWith('/realtime-snapshot')).length);
    await page.evaluate(() => {
      const section = window.fixture.board.sections[0];
      section.posts = section.posts.filter(post => post.id !== 'other-post'); section.totalPostCount -= 1;
      window.emit({ type: 'board.updated', entityId: 'board', payload: { requiresSync: true } });
    });
    await page.waitForFunction(count => window.calls.filter(call => call.url.endsWith('/realtime-snapshot')).length > count, snapshotCount);
    await settle(); await finish(0);
    await page.getByText("삭제된 다른 글", { exact: true }).waitFor({ state: "detached" });
    await expectSection(1);
  });

  await test("본문과 작성기 목록의 글머리표와 번호 표시", async () => {
    await render({ body: "- 하나\n- 둘\n\n1. 첫째\n2. 둘째" });
    await card.locator(".markdown-body ul li").first().waitFor();
    const check = async selector => {
      assert.deepEqual(await page.locator(selector).evaluateAll(elements => elements.map(el => ({
        tag: el.tagName, marker: getComputedStyle(el).listStyleType, items: el.children.length,
      }))), [{ tag: "UL", marker: "disc", items: 2 }, { tag: "OL", marker: "decimal", items: 2 }]);
    };
    await check(".section-column .markdown-body ul, .section-column .markdown-body ol");
    await card.getByRole("button", { name: "테스트 게시물 옵션", exact: true }).click();
    await page.getByRole("button", { name: "게시물 수정", exact: true }).click();
    await page.locator(".composer-markdown-editor .editor ul li").first().waitFor();
    await check(".composer-markdown-editor .editor ul, .composer-markdown-editor .editor ol");
  });
  assert.deepEqual(failures, [], failures.join("\n"));
}
