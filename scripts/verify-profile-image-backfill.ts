import assert from "node:assert/strict";
import { mkdtemp, readFile, readdir, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, mock, test } from "node:test";
import type { PrismaClient } from "../generated/prisma/client";
import { decryptOptionalUserPii, encryptOptionalUserPii } from "../lib/security/pii-crypto-core";
import { backfillProfileImages } from "./backfill-profile-images";

process.env.PII_ACTIVE_KEY_ID = "profile_image_test";
process.env.PII_ENCRYPTION_KEY_PROFILE_IMAGE_TEST = Buffer.alloc(32, 17).toString("base64");
process.env.PII_LOOKUP_KEY = Buffer.alloc(32, 19).toString("base64");
afterEach(() => mock.restoreAll());

function fixture() {
  const rows = [
    { id: "good", image: "http://img1.kakaocdn.net/good.jpg" },
    { id: "broken", image: "http://img1.kakaocdn.net/broken.jpg" },
    { id: "upload", image: "/api/users/upload/avatar" },
    { id: "https", image: "https://img1.kakaocdn.net/already.jpg" },
    { id: "other", image: "http://images.example.org/photo.jpg" },
  ].map(({ id, image }) => ({ id, imageEncrypted: encryptOptionalUserPii(id, "image", image) }));
  const updates: { where: { id: string; imageEncrypted: string }; data: { imageEncrypted: string | null } }[] = [];
  const requests: string[] = [];
  mock.method(globalThis, "fetch", async (url: string) => {
    requests.push(url);
    return new Response(null, { status: url.includes("broken") ? 404 : 200, headers: { "content-type": "image/jpeg" } });
  });
  const client = { user: {
    findMany: async () => rows,
    updateMany: async (args: typeof updates[number]) => { updates.push(args); return { count: 1 }; },
  }, $transaction: async (callback: (tx: unknown) => Promise<unknown>) => callback(client) };
  return { prisma: client as unknown as PrismaClient, rows, updates, requests };
}

test("DB dry-run은 HTTPS를 검사하지만 데이터와 백업 파일을 쓰지 않음", async () => {
  const f = fixture();
  const result = await backfillProfileImages(f.prisma);
  assert.deepEqual(result, { candidates: 2, https: 1, fallback: 1, updated: 0, backupPath: null });
  assert.deepEqual(f.requests, ["https://img1.kakaocdn.net/good.jpg", "https://img1.kakaocdn.net/broken.jpg"]);
  assert.deepEqual(f.updates, []);
});

test("DB 적용은 백업 후 대상의 이미지 필드만 조건부 갱신", async (t) => {
  const backupDirectory = await mkdtemp(join(tmpdir(), "pyxis-profile-backfill-test-"));
  t.after(() => rm(backupDirectory, { recursive: true, force: true }));
  const f = fixture();
  mock.method(f.prisma, "$transaction", async (callback: (tx: unknown) => Promise<unknown>) => {
    const [directory] = await readdir(backupDirectory);
    const backup = JSON.parse(await readFile(join(backupDirectory, directory, "images.json"), "utf8"));
    assert.deepEqual(backup.changes.map((change: { id: string; before: string }) => ({ id: change.id, imageEncrypted: change.before })), f.rows.slice(0, 2), "암호화 원본이 쓰기 전에 백업되어야 함");
    return callback(f.prisma);
  });
  const result = await backfillProfileImages(f.prisma, { apply: true, backupDirectory });
  assert.equal(result.updated, 2);
  assert.ok(result.backupPath);
  assert.equal((await stat(result.backupPath)).mode & 0o777, 0o600);
  assert.deepEqual(f.updates.map(update => update.where), f.rows.slice(0, 2), "조회 시점의 암호문으로 동시 수정 보호");
  assert.deepEqual(f.updates.map(update => Object.keys(update.data)), [["imageEncrypted"], ["imageEncrypted"]]);
  assert.equal(decryptOptionalUserPii("good", "image", f.updates[0].data.imageEncrypted), "https://img1.kakaocdn.net/good.jpg");
  assert.equal(f.updates[1].data.imageEncrypted, null);
});

test("DB 적용 중 사용자 사진이 변경되었으면 트랜잭션을 실패시켜 덮어쓰지 않음", async (t) => {
  const backupDirectory = await mkdtemp(join(tmpdir(), "pyxis-profile-backfill-conflict-test-"));
  t.after(() => rm(backupDirectory, { recursive: true, force: true }));
  const f = fixture();
  mock.method(f.prisma.user, "updateMany", async () => ({ count: 0 }));
  await assert.rejects(backfillProfileImages(f.prisma, { apply: true, backupDirectory }), /동시에 변경/);
});
