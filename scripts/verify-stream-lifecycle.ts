import assert from "node:assert/strict";
import { getEventListeners } from "node:events";
import { mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { streamMultipartFile } from "../lib/files/multipart";
import { createEventStream } from "../lib/realtime/sse-stream";

const partialFile = '--test\r\nContent-Disposition: form-data; name="file"; filename="test.txt"\r\nContent-Type: text/plain\r\n\r\npartial';

for (const mode of ["abort", "already-aborted", "read-error", "total-limit"] as const) {
  test(`multipart ${mode} stops input and cleans temporary files`, { timeout: 2000 }, async () => {
    const directory = await mkdtemp(path.join(tmpdir(), "pyxis-stream-"));
    const abort = new AbortController();
    let cancelled = false;
    let trigger: ReturnType<typeof setTimeout> | undefined;
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new TextEncoder().encode(partialFile));
        if (mode === "already-aborted") abort.abort();
        if (mode === "abort" || mode === "read-error") trigger = setTimeout(() => {
          if (mode === "abort") abort.abort();
          else controller.error(new Error("source disconnected"));
        }, 30);
      },
      cancel() { cancelled = true; },
    });
    const request = new Request("http://localhost/upload", {
      method: "POST", headers: { "content-type": "multipart/form-data; boundary=test" },
      body, signal: abort.signal, duplex: "half",
    } as RequestInit);
    try {
      await assert.rejects(streamMultipartFile(request, directory, 1024, {
        maxTotalBytes: mode === "total-limit" ? 100 : 2048,
      }), mode === "read-error" ? /source disconnected/ : mode === "total-limit" ? /허용 크기/ : /취소/);
      assert.deepEqual(await readdir(directory), []);
      if (mode !== "read-error") assert.equal(cancelled, true);
    } finally {
      clearTimeout(trigger);
      abort.abort();
      await rm(directory, { recursive: true, force: true });
    }
  });
}

test("SSE rejects repeated excess connections with independent readable JSON bodies", async () => {
  const options = {
    request: new Request("http://localhost/events"),
    connectionKey: "test:limit", maxPerKey: 1, subscribe() {},
  };
  const active = createEventStream(options);
  try {
    for (let i = 0; i < 2; i++) {
      const denied = createEventStream(options);
      assert.equal(denied.status, 429);
      assert.match((await denied.json()).error, /실시간 연결/);
    }
  } finally { await active.body!.cancel(); }
});

test("SSE does not subscribe on an already aborted request", async () => {
  const abort = new AbortController();
  abort.abort();
  let subscribed = false;
  const response = createEventStream({
    request: new Request("http://localhost/events", { signal: abort.signal }),
    connectionKey: "test:aborted", maxPerKey: 1,
    subscribe() { subscribed = true; },
  });
  assert.equal(await response.text(), "");
  assert.equal(subscribed, false);
});

test("truncated multipart rejects without an unhandled file-write rejection or leftover file", async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "pyxis-stream-"));
  try {
    const request = new Request("http://localhost/upload", {
      method: "POST",
      headers: { "content-type": "multipart/form-data; boundary=test" },
      body: '--test\r\nContent-Disposition: form-data; name="file"; filename="test.txt"\r\nContent-Type: text/plain\r\n\r\npartial',
    });
    await assert.rejects(streamMultipartFile(request, directory, 1024), /Unexpected end of form/);
    await new Promise((resolve) => setTimeout(resolve, 30));
    assert.deepEqual(await readdir(directory), []);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("SSE synchronous close releases the subscription returned afterward", async () => {
  let subscriptions = 0;
  const response = createEventStream({
    request: new Request("http://localhost/events"),
    connectionKey: "test:sync-close",
    maxPerKey: 1,
    subscribe(_emit, close) {
      subscriptions++;
      close();
      return () => { subscriptions--; };
    },
  });
  assert.equal(await response.text(), "");
  assert.equal(subscriptions, 0);
});

test("SSE cancellation removes the abort listener and releases its slot", async () => {
  const request = new Request("http://localhost/events");
  let unsubscribed = 0;
  const options = {
    request, connectionKey: "test:cancel", maxPerKey: 1,
    subscribe() { return () => { unsubscribed++; }; },
  };
  const response = createEventStream(options);
  await response.body!.cancel();
  assert.equal(unsubscribed, 1);
  assert.equal(getEventListeners(request.signal, "abort").length, 0);
  const next = createEventStream(options);
  assert.equal(next.status, 200);
  await next.body!.cancel();
});
