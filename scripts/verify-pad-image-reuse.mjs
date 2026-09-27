import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, writeFile, readFile, unlink, rm } from "node:fs/promises";
import { pipeline } from "node:stream/promises";
import { createWriteStream } from "node:fs";
import os from "node:os";
import path from "node:path";
import { inflateRawSync } from "node:zlib";
import { loadImageModule } from "./pad-image-test-harness.mjs";
const { openAttachmentRepresentation } = await loadImageModule("@/lib/files/attachment-read");
test("copy/export reopens a swapped representation with matching MIME and survives source deletion", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(),"pad-image-copy-"));process.env.UPLOAD_DIR=directory;
  try {
    const previous = {id:"fixture",storagePath:"gone.jpg",storedName:"gone.jpg",mimeType:"image/jpeg",originalName:"photo.jpg"};
    const current = {...previous,storagePath:"new.webp",storedName:"new.webp",mimeType:"image/webp",originalName:"photo.webp"};
    globalThis.padImageDb = { attachment:{findFirst:async()=>current} };
    await writeFile(path.join(directory,"new.webp"),"converted-fixture");
    const opened = await openAttachmentRepresentation(previous);
    assert.equal(opened.attachment.mimeType,"image/webp");
    assert.equal(opened.attachment.originalName,"photo.webp");
    await unlink(path.join(directory,"new.webp"));
    await pipeline(opened.handle.createReadStream(),createWriteStream(path.join(directory,"copy.webp")));
    assert.equal(await readFile(path.join(directory,"copy.webp"),"utf8"),"converted-fixture");
  } finally {await rm(directory,{recursive:true,force:true});delete process.env.UPLOAD_DIR;}
});

test("actual ZIP exports the current representation name and bytes after a path swap", async () => {
  const directory=await mkdtemp(path.join(os.tmpdir(),"pad-image-zip-"));process.env.UPLOAD_DIR=directory;
  try {
    const previous={id:"fixture",type:"IMAGE",storagePath:"gone.jpg",originalName:"photo.jpg",mimeType:"image/jpeg"};
    const current={...previous,storagePath:"new.webp",originalName:"photo.webp",mimeType:"image/webp"};
    globalThis.padImageDb={attachment:{findFirst:async()=>current}};
    await writeFile(path.join(directory,"new.webp"),"converted-fixture");
    const {buildAttachmentsZipStream}=await loadImageModule("@/lib/exports/attachments-zip");
    const chunks=[];
    for await(const chunk of buildAttachmentsZipStream({posts:[{id:"post-fixture",title:"Post",sectionTitle:"Section",attachments:[previous]}]})) chunks.push(chunk);
    const zip=Buffer.concat(chunks);
    const end=zip.length-22;
    assert.equal(zip.readUInt32LE(end),0x06054b50);
    const central=zip.readUInt32LE(end+16);
    assert.equal(zip.readUInt32LE(central),0x02014b50);
    const name=zip.subarray(central+46,central+46+zip.readUInt16LE(central+28)).toString();
    assert.match(name,/\/photo\.webp$/);
    const local=zip.readUInt32LE(central+42);
    const start=local+30+zip.readUInt16LE(local+26)+zip.readUInt16LE(local+28);
    const compressed=zip.subarray(start,start+zip.readUInt32LE(central+20));
    assert.equal(inflateRawSync(compressed).toString(),"converted-fixture");
  } finally {await rm(directory,{recursive:true,force:true});delete process.env.UPLOAD_DIR;}
});
