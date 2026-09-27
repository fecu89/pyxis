import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, writeFile, unlink, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { loadImageModule } from "./pad-image-test-harness.mjs";
const { attachmentImageUrl, mergeAttachmentImage, preserveImageRevisions, upsertAttachmentImage } = await loadImageModule("@/lib/files/attachment-url");
test("detail completion before save introduces the attachment and survives an older save response", () => {
  const initial = {id:"new",type:"IMAGE",imageRevision:0,mimeType:"image/jpeg",originalName:"new.jpg",fileSize:100};
  const completed = {...initial,imageRevision:1,mimeType:"image/webp",originalName:"new.webp",fileSize:50};
  const afterEvent = upsertAttachmentImage([], completed, completed);
  const afterSave = preserveImageRevisions(afterEvent, [initial]);
  assert.equal(afterSave[0].imageRevision, 1);
  assert.equal(afterSave[0].mimeType, "image/webp");
  assert.equal(upsertAttachmentImage([{...completed,caption:"latest"}], {...completed,caption:"old"}, {id:"new",imageRevision:1})[0].caption, "latest");
});
test("older snapshots cannot downgrade converted images or overwrite newer captions", () => {
  const initial = {id:"a",imageRevision:0,mimeType:"image/jpeg",originalName:"a.jpg",fileSize:100,width:16,height:12,caption:"old"};
  const converted = {...initial,imageRevision:1,mimeType:"image/webp",originalName:"a.webp",fileSize:50,caption:"edited"};
  assert.equal(attachmentImageUrl(converted,"thumbnail"),"/f/a?v=1&variant=thumbnail");
  assert.equal(mergeAttachmentImage(converted,initial).imageRevision,1);
  assert.equal(mergeAttachmentImage(converted,{id:"a",caption:"latest"}).caption,"latest");
  assert.equal(preserveImageRevisions([converted],[initial])[0].mimeType,"image/webp");
});
test("file swap retries with current authorization and open streams survive unlink", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(),"pad-image-serving-"));process.env.UPLOAD_DIR=directory;
  let reads = 0;
  let access = true;
  const row = {deletedAt:null,originalName:"photo.webp",storagePath:"new.webp",thumbnailPath:null,mimeType:"image/webp",type:"IMAGE",imageRevision:1,post:{boardId:"b",deletedAt:null,status:"PUBLISHED",authorId:null}};
  globalThis.padImageDb = { attachment: { findUnique: async () => ++reads === 1 ? {...row,storagePath:"gone.jpg",mimeType:"image/jpeg"} : row } };
  globalThis.padImageCanRead = () => access;
  const { GET } = await loadImageModule("@/app/(play)/f/[attachmentId]/route", {
    "@/lib/auth/current-user":"export const getCurrentUser=async()=>null;",
    "@/lib/auth/authorization":"export const getEffectiveBoardAccess=async()=>({});export const canReadEffectiveBoard=()=>globalThis.padImageCanRead();export const canDownloadAttachment=()=>true;export const canModeratePosts=()=>false;",
  });
  const params = {params:Promise.resolve({attachmentId:"a"})};
  try {
    await writeFile(path.join(directory,"new.webp"),Buffer.from("fixture-bytes"));
    const response = await GET(new Request("https://fixture.invalid/f/a"),params);
    assert.equal(response.status,200);assert.equal(response.headers.get("content-type"),"image/webp");
    assert.equal(reads,2);
    await unlink(path.join(directory,"new.webp"));
    assert.equal(await response.text(),"fixture-bytes");
    access = false;
    assert.equal((await GET(new Request("https://fixture.invalid/f/a",{headers:{"if-none-match":response.headers.get("etag")}}),params)).status,403);
  } finally { await rm(directory,{recursive:true,force:true});delete process.env.UPLOAD_DIR; }
});

test("pending images retain author/moderator access gates and range/cache behavior", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(),"pad-image-access-")); process.env.UPLOAD_DIR=directory;
  const row={deletedAt:null,originalName:"photo.jpg",storagePath:"photo.jpg",thumbnailPath:null,mimeType:"image/jpeg",type:"IMAGE",imageRevision:0,post:{boardId:"b",deletedAt:null,status:"PENDING",authorId:"author"}};
  globalThis.padImageDb={attachment:{findUnique:async()=>row}};
  const {GET}=await loadImageModule("@/app/(play)/f/[attachmentId]/route",{
    "@/lib/auth/current-user":"export const getCurrentUser=async()=>globalThis.padImageActor;",
    "@/lib/auth/authorization":"export const getEffectiveBoardAccess=async()=>({});export const canReadEffectiveBoard=()=>globalThis.padImageReadable;export const canDownloadAttachment=()=>false;export const canModeratePosts=(user)=>user.id==='moderator';",
  });
  const request=(suffix="",headers={})=>GET(new Request(`https://fixture.invalid/f/a${suffix}`,{headers}),{params:Promise.resolve({attachmentId:"a"})});
  try {
    await writeFile(path.join(directory,"photo.jpg"),"image-fixture");
    globalThis.padImageReadable=true;
    for(const [actor,status] of [[null,403],[{id:"other"},403],[{id:"author"},200],[{id:"moderator"},200]]) {
      globalThis.padImageActor=actor; const response=await request();
      assert.equal(response.status,status); await response.arrayBuffer();
    }
    globalThis.padImageActor=null; row.post.authorId=null;
    assert.equal((await request()).status,403); // Existing anonymous pending-photo policy stays unchanged.
    row.post.status="PUBLISHED";
    const original=await request(); await original.arrayBuffer();
    const etag=original.headers.get("etag");
    assert.equal((await request("",{"if-none-match":etag})).status,304);
    const range=await request("",{range:"bytes=0-4"}); assert.equal(range.status,206); assert.equal(await range.text(),"image");
    assert.equal((await request("",{range:"bytes=999-"})).status,416);
    assert.equal((await request("?download=1")).status,403);
    globalThis.padImageReadable=false;
    assert.equal((await request("",{"if-none-match":etag})).status,403);
  } finally { await rm(directory,{recursive:true,force:true});delete process.env.UPLOAD_DIR; }
});
