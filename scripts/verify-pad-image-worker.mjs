import assert from "node:assert/strict";
import test from "node:test";
import sharp from "sharp";
import { mkdtemp, writeFile, readFile, rm, mkdir } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { loadImageModule, createImageTestDb, createImageBoard, uploadMocks } from "./pad-image-test-harness.mjs";
const { runImageJobOnce } = await loadImageModule("@/lib/files/image-worker", uploadMocks);
const { cleanupImageJobs } = await loadImageModule("@/lib/files/image-job-cleanup");
const { transformImage } = await loadImageModule("@/lib/files/image-transform");
const { claimImageJob } = await loadImageModule("@/lib/files/image-job-store");
test("completion publication cannot follow deletion after capturing a live snapshot", async () => {
  const db = await createImageTestDb();
  const fixture = await createImageBoard(db);
  const directory = await mkdtemp(path.join(os.tmpdir(), "pad-image-event-race-"));
  process.env.UPLOAD_DIR = directory;
  globalThis.padImageEvents = [];
  let resume, captured;
  const barrier = new Promise(resolve => { resume = resolve; });
  const ready = new Promise(resolve => { captured = resolve; });
  globalThis.padImageDb = db.$extends({query:{attachment:{async findUnique({args,query}) {
    const result = await query(args);
    if (args.select?.imageRevision && args.select?.post) { captured(); await barrier; }
    return result;
  }}}});
  try {
    await writeFile(path.join(directory,"source.jpg"),await sharp({create:{width:16,height:12,channels:3,background:"blue"}}).jpeg().toBuffer());
    const a = await db.attachment.create({data:{postId:fixture.post.id,type:"IMAGE",originalName:"source.jpg",mimeType:"image/jpeg",fileSize:100,storagePath:"source.jpg"}});
    await db.imageProcessingJob.create({data:{attachmentId:a.id,boardId:fixture.board.id,postId:fixture.post.id,inputPath:"source.jpg"}});
    const running = runImageJobOnce();
    await ready;
    const deleting = db.attachment.update({where:{id:a.id},data:{deletedAt:new Date()}}).then(() => {
      globalThis.padImageEvents.push({type:"attachment.deleted"});
    });
    // Let deletion commit if the worker isn't holding the row lock. With the lock,
    // publication must happen first and deletion can complete only after release.
    await Promise.race([deleting, new Promise(resolve => setTimeout(resolve,100))]);
    resume();
    await Promise.all([running,deleting]);
    assert.deepEqual(globalThis.padImageEvents.map(event => event.type),["attachment.updated","attachment.deleted"]);
  } finally {
    resume(); await fixture.cleanup(); await db.$disconnect();
    await rm(directory,{recursive:true,force:true}); delete process.env.UPLOAD_DIR;
  }
});
test("worker atomically replaces image; source survives until cleanup and deleted posts never resurrect", async () => {
  const db = await createImageTestDb(); globalThis.padImageDb = db; globalThis.padImageEvents = [];
  const fixture = await createImageBoard(db);
  const directory = await mkdtemp(path.join(os.tmpdir(), "pad-image-worker-")); process.env.UPLOAD_DIR = directory;
  try {
    const source = `boards/${fixture.board.id}/posts/${fixture.post.id}/input.jpg`;
    await mkdir(path.dirname(path.join(directory,source)),{recursive:true});
    await writeFile(path.join(directory,source), await sharp({create:{width:16,height:12,channels:3,background:"red"}}).jpeg().toBuffer());
    const attachment = await db.attachment.create({data:{postId:fixture.post.id,guestId:"fixture-guest",type:"IMAGE",originalName:"photo.jpg",mimeType:"image/jpeg",fileSize:100,storagePath:source}});
    await db.imageProcessingJob.create({data:{attachmentId:attachment.id,boardId:fixture.board.id,postId:fixture.post.id,inputPath:source}});
    assert.equal(await runImageJobOnce(new Date()),true);
    const updated = await db.attachment.findUnique({where:{id:attachment.id}});
    assert.equal(updated.mimeType,"image/webp"); assert.equal(updated.imageRevision,1);
    assert((await readFile(path.join(directory,source))).length>0);
    assert.equal((await sharp(path.join(directory,updated.storagePath)).metadata()).format,"webp");
    assert.equal(globalThis.padImageEvents[0].payload.attachmentPatch.imageRevision,1);
    await cleanupImageJobs(new Date(Date.now()+61000));
    await assert.rejects(readFile(path.join(directory,source)),{code:"ENOENT"});
    assert((await readFile(path.join(directory,updated.storagePath))).length>0);
    const second = await db.attachment.create({data:{postId:fixture.post.id,guestId:"fixture-guest",type:"IMAGE",originalName:"photo.jpg",mimeType:"image/jpeg",fileSize:100,storagePath:source}});
    await db.imageProcessingJob.create({data:{attachmentId:second.id,boardId:fixture.board.id,postId:fixture.post.id,inputPath:source}});
    await db.post.update({where:{id:fixture.post.id},data:{deletedAt:new Date()}});
    await runImageJobOnce(new Date());
    assert.equal((await db.attachment.findUnique({where:{id:second.id}})).imageRevision,0);
    assert.equal((await db.imageProcessingJob.findUnique({where:{attachmentId:second.id}})).status,"CLEANUP_PENDING");
  } finally {
    await fixture.cleanup(); await db.$disconnect(); await rm(directory,{recursive:true,force:true}); delete process.env.UPLOAD_DIR;
  }
});

test("expired worker cannot replace a newer lease or resurrect a deleted attachment", async () => {
  const db=await createImageTestDb();globalThis.padImageDb=db;
  const fixture=await createImageBoard(db);
  const directory=await mkdtemp(path.join(os.tmpdir(),"pad-image-race-"));process.env.UPLOAD_DIR=directory;
  try {
    for(const action of ["expire","delete"]) {
      const source=`${action}.jpg`;
      await writeFile(path.join(directory,source),await sharp({create:{width:16,height:12,channels:3,background:"blue"}}).jpeg().toBuffer());
      const a=await db.attachment.create({data:{postId:fixture.post.id,guestId:"fixture-guest",type:"IMAGE",originalName:source,mimeType:"image/jpeg",fileSize:100,storagePath:source}});
      const job=await db.imageProcessingJob.create({data:{attachmentId:a.id,boardId:fixture.board.id,postId:fixture.post.id,inputPath:source}});
      let unblock,started;const barrier=new Promise(r=>unblock=r);const ready=new Promise(r=>started=r);
      globalThis.padImageTransform=async(...args)=>{const output=await transformImage(...args);started();await barrier;return output;};
      const paused=await loadImageModule("@/lib/files/image-worker",{...uploadMocks,"@/lib/files/image-transform":"export const transformImage=(...args)=>globalThis.padImageTransform(...args);"});
      const running=paused.runImageJobOnce(new Date());await ready;
      if(action==="expire") {
        await db.imageProcessingJob.update({where:{id:job.id},data:{leaseExpiresAt:new Date(0)}});
        const newClaim=await claimImageJob(new Date());assert(newClaim);
      } else await db.attachment.delete({where:{id:a.id}});
      unblock();await running;
      const current=await db.attachment.findUnique({where:{id:a.id}});
      if(action==="expire"){assert.equal(current.imageRevision,0);assert.equal(current.storagePath,source);}
      else assert.equal(current,null);
      assert((await readFile(path.join(directory,source))).length>0);
      await db.imageProcessingJob.delete({where:{id:job.id}});
    }
  } finally {await fixture.cleanup();await db.$disconnect();await rm(directory,{recursive:true,force:true});delete process.env.UPLOAD_DIR;}
});
