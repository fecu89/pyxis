import assert from "node:assert/strict";
import test from "node:test";
import sharp from "sharp";
import { mkdtemp, rm, readFile, readdir } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { loadImageModule, createImageTestDb, createImageBoard, uploadMocks, imageUploadRequest } from "./pad-image-test-harness.mjs";
const route = await loadImageModule("@/app/api/posts/[postId]/attachments/route", {
  ...uploadMocks,
  "@/lib/files/processing-queue": "export const withImageProcessingSlot=async task=>{globalThis.padImageTransforms++;return task();};",
});

test("30 concurrent posters finish without acquiring a conversion slot", {timeout:20000}, async () => {
  const db=await createImageTestDb();globalThis.padImageDb=db;globalThis.padImageAccess=true;
  const directory=await mkdtemp(path.join(os.tmpdir(),"pad-image-parallel-"));process.env.UPLOAD_DIR=directory;
  process.env.PAD_BACKGROUND_IMAGES_ENABLED="true";
  const fixtures=[];
  const noConversion=await loadImageModule("@/app/api/posts/[postId]/attachments/route",{
    ...uploadMocks,"@/lib/files/processing-queue":"export const withImageProcessingSlot=()=>{throw new Error('conversion blocked')};",
  });
  try {
    const bytes=await sharp({create:{width:16,height:12,channels:3,background:"green"}}).png().toBuffer();
    for(let i=0;i<30;i++)fixtures.push(await createImageBoard(db));
    const responses=await Promise.all(fixtures.map(f=>noConversion.POST(imageUploadRequest(bytes,"photo.png"),{params:Promise.resolve({postId:f.post.id})})));
    assert(responses.every(r=>r.status===201));
    const ids=fixtures.map(f=>f.post.id);
    assert.equal(await db.imageProcessingJob.count({where:{postId:{in:ids},status:"PENDING"}}),30);
    assert.equal(await db.attachment.count({where:{postId:{in:ids},mimeType:"image/png"}}),30);
  } finally {for(const f of fixtures)await f.cleanup();await db.$disconnect();await rm(directory,{recursive:true,force:true});delete process.env.UPLOAD_DIR;delete process.env.PAD_BACKGROUND_IMAGES_ENABLED;}
});
test("fast upload returns a readable original and durable job before any conversion", async () => {
  const db = await createImageTestDb(); globalThis.padImageDb = db;
  const fixture = await createImageBoard(db);
  const directory = await mkdtemp(path.join(os.tmpdir(), "pad-image-upload-"));
  process.env.UPLOAD_DIR = directory; process.env.PAD_BACKGROUND_IMAGES_ENABLED = "true";
  globalThis.padImageTransforms = 0;
  const bytes = await sharp({create:{width:16,height:12,channels:3,background:"blue"}}).jpeg().toBuffer();
  try {
    const response = await route.POST(imageUploadRequest(bytes), {params:Promise.resolve({postId:fixture.post.id})});
    assert.equal(response.status, 201);
    assert.equal(globalThis.padImageTransforms, 0);
    const {attachment} = await response.json();
    assert.equal(attachment.mimeType, "image/jpeg");
    const stored = await db.attachment.findUnique({where:{id:attachment.id}});
    assert.equal((await sharp(await readFile(path.join(directory, stored.storagePath))).metadata()).format,"jpeg");
    assert.equal(await db.imageProcessingJob.count({where:{attachmentId:attachment.id}}), 1);
    process.env.PAD_BACKGROUND_IMAGES_ENABLED = "false";
    const fallback = await route.POST(imageUploadRequest(bytes), {params:Promise.resolve({postId:fixture.post.id})});
    assert.equal(fallback.status, 201);
    assert.equal((await fallback.json()).attachment.mimeType, "image/webp");
    assert.equal(globalThis.padImageTransforms, 1);
    globalThis.padImageAccess = false;
    assert.equal((await route.POST(imageUploadRequest(bytes), {params:Promise.resolve({postId:fixture.post.id})})).status,403);
    globalThis.padImageAccess = true;
    for(let i=0;i<3;i++) assert.equal((await route.POST(imageUploadRequest(bytes), {params:Promise.resolve({postId:fixture.post.id})})).status,201);
    assert.equal((await route.POST(imageUploadRequest(bytes), {params:Promise.resolve({postId:fixture.post.id})})).status,400);
    assert.equal(await db.attachment.count({where:{postId:fixture.post.id}}),5);
    process.env.PAD_BACKGROUND_IMAGES_ENABLED="true";
    await db.imageProcessingJob.createMany({data:Array.from({length:255},(_,i)=>({attachmentId:`full-${i}`,boardId:fixture.board.id,postId:fixture.post.id,inputPath:"not-written.jpg"}))});
    const extra=await db.post.create({data:{boardId:fixture.board.id,sectionId:fixture.section.id,position:10,guestId:"fixture-guest"}});
    const full=await route.POST(imageUploadRequest(bytes),{params:Promise.resolve({postId:extra.id})});
    assert.equal(full.status,503);assert.equal(full.headers.get("retry-after"),"5");
    assert.equal(await db.attachment.count({where:{postId:extra.id}}),0);
    assert.equal((await readdir(path.join(directory,"boards",fixture.board.id,"posts",extra.id))).length,0);
  } finally {
    await fixture.cleanup(); await db.$disconnect(); await rm(directory,{recursive:true,force:true});
    delete process.env.UPLOAD_DIR; delete process.env.PAD_BACKGROUND_IMAGES_ENABLED;
  }
});
