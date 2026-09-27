import assert from "node:assert/strict";
import test from "node:test";
import { loadImageModule, createImageTestDb } from "./pad-image-test-harness.mjs";
const { retryDelayMs, enqueueImageJob, claimImageJob, renewImageJob, failImageJob } = await loadImageModule("@/lib/files/image-job-store");
test("five attempts reach a terminal failure instead of an infinite retry loop", () => {
  let retries = 0;
  for (let attempt = 1; attempt <= 10; attempt++) {
    if (retryDelayMs(attempt) === null) break;
    retries++;
  }
  assert.equal(retries, 4);
  assert.deepEqual([1,2,3,4].map(retryDelayMs), [5000,30000,120000,600000]);
});
test("real PostgreSQL fences duplicate claims, retries, and queue capacity", async () => {
  const db = await createImageTestDb(); globalThis.padImageDb = db;
  try {
    await db.imageProcessingJob.deleteMany();
    await db.$transaction(tx => enqueueImageJob(tx, { attachmentId:"fixture-a", boardId:"fixture-b", postId:"fixture-p", inputPath:"fixture.jpg" }));
    const now = new Date();
    const claims = await Promise.all([claimImageJob(now), claimImageJob(now)]);
    assert.equal(claims.filter(Boolean).length, 1);
    const old = claims.find(Boolean);
    const later = new Date(now.getTime() + 121000);
    const replacement = await claimImageJob(later);
    assert(replacement); assert.notEqual(replacement.leaseToken, old.leaseToken);
    assert.equal(await renewImageJob(old, later), false);
    await failImageJob(old, "stale", later);
    assert.equal((await db.imageProcessingJob.findUnique({where:{id:old.id}})).status, "PROCESSING");
    await failImageJob(replacement, "conversion", later);
    assert.equal(await claimImageJob(later), null);
    let clock = new Date(later.getTime() + 30001);
    for (let attempt = 3; attempt <= 5; attempt++) {
      const claim = await claimImageJob(clock); assert(claim);
      await failImageJob(claim, "conversion", clock);
      clock = new Date(clock.getTime() + 600001);
    }
    assert.equal(await claimImageJob(clock), null);
    assert.equal((await db.imageProcessingJob.findUnique({where:{id:old.id}})).status, "FAILED");
    await db.imageProcessingJob.createMany({data:Array.from({length:255}, (_,i) => ({attachmentId:`capacity-${i}`,boardId:"b",postId:"p",inputPath:"x.jpg"}))});
    await assert.rejects(db.$transaction(tx => enqueueImageJob(tx, { attachmentId:"overflow",boardId:"b",postId:"p",inputPath:"x.jpg" })), /몰려/);
    assert.equal(await db.imageProcessingJob.count(), 256);
  } finally { await db.imageProcessingJob.deleteMany(); await db.$disconnect(); }
});
