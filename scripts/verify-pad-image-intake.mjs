import assert from "node:assert/strict";
import test from "node:test";
import sharp from "sharp";
import { mkdtemp, writeFile, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { loadImageModule } from "./pad-image-test-harness.mjs";

const { stripPrivateImageMetadata } = await loadImageModule("@/lib/files/image-metadata");
const { prepareInitialImage } = await loadImageModule("@/lib/files/image-intake");
const picture = () => sharp({ create: { width: 16, height: 12, channels: 3, background: "red" } });

function gpsExifSegment(orientation) {
  // Genuine TIFF GPS IFD with LatitudeRef + three latitude rationals (synthetic location).
  const exif = Buffer.alloc(98);
  exif.write("Exif\0\0", 0, "binary");
  const tiff = exif.subarray(6);
  tiff.write("II"); tiff.writeUInt16LE(42,2); tiff.writeUInt32LE(8,4);
  tiff.writeUInt16LE(2,8);
  tiff.writeUInt16LE(0x0112,10); tiff.writeUInt16LE(3,12); tiff.writeUInt32LE(1,14); tiff.writeUInt16LE(orientation,18);
  tiff.writeUInt16LE(0x8825,22); tiff.writeUInt16LE(4,24); tiff.writeUInt32LE(1,26); tiff.writeUInt32LE(38,30);
  tiff.writeUInt16LE(2,38);
  tiff.writeUInt16LE(1,40); tiff.writeUInt16LE(2,42); tiff.writeUInt32LE(2,44); tiff.write("N\0",48,"binary");
  tiff.writeUInt16LE(2,52); tiff.writeUInt16LE(5,54); tiff.writeUInt32LE(3,56); tiff.writeUInt32LE(68,60);
  for (let i=0;i<3;i++) { tiff.writeUInt32LE([37,12,34][i],68+i*8); tiff.writeUInt32LE(1,72+i*8); }
  const header=Buffer.from([0xff,0xe1,0,0]); header.writeUInt16BE(exif.length+2,2);
  return Buffer.concat([header,exif]);
}

for (const [format, mime] of [["jpeg", "image/jpeg"], ["png", "image/png"], ["webp", "image/webp"]]) {
  test(`${format}: private metadata removed without recompressing pixels`, async () => {
    const input = await picture()[format]().withExif({ IFD0: { ImageDescription: "private-fixture" } }).toBuffer();
    const result = stripPrivateImageMetadata(input, mime, 1);
    assert.equal(result.kind, "ready");
    assert.equal(result.bytes.includes(Buffer.from("private-fixture")), false);
    assert.deepEqual(await sharp(result.bytes).raw().toBuffer(), await sharp(input).raw().toBuffer());
    assert.equal((await sharp(result.bytes).metadata()).exif, undefined);
  });
  test(`${format}: truncated container is rejected`, async () => {
    const input = await picture()[format]().toBuffer();
    assert.throws(() => stripPrivateImageMetadata(input.subarray(0, input.length - 5), mime, 1));
  });
}
test("JPEG orientation 1–8 survives without copying GPS or description", async () => {
  const pixels = Buffer.alloc(16*12*3);
  for (let y=0;y<12;y++) for (let x=0;x<16;x++) {
    const offset=(y*16+x)*3;
    pixels[offset]=x*16; pixels[offset+1]=y*21; pixels[offset+2]=(x+y)%2*255;
  }
  for (let orientation = 1; orientation <= 8; orientation++) {
    const encoded = await sharp(pixels,{raw:{width:16,height:12,channels:3}}).jpeg().withMetadata({ orientation })
      .withExifMerge({ IFD0: { ImageDescription: "private-location" } }).toBuffer();
    const gps = gpsExifSegment(orientation);
    const input = Buffer.concat([encoded.subarray(0,2),gps,encoded.subarray(2)]);
    assert(input.includes(gps));
    const result = stripPrivateImageMetadata(input, "image/jpeg", orientation);
    assert.equal(result.kind, "ready");
    assert.equal(result.bytes.includes(Buffer.from("private-location")), false);
    const meta = await sharp(result.bytes).metadata();
    assert.equal(result.bytes.includes(gps), false);
    assert.equal(meta.exif?.length ?? 0, orientation === 1 ? 0 : 32);
    assert.equal(meta.orientation ?? 1, orientation);
    assert.deepEqual(await sharp(result.bytes).rotate().raw().toBuffer(), await sharp(input).rotate().raw().toBuffer());
    assert.deepEqual(meta.icc, (await sharp(input).metadata()).icc);
  }
});
test("unsupported orientation containers fall back, never expose original EXIF", async () => {
  const input = await picture().png().withMetadata({ orientation: 6 }).toBuffer();
  assert.equal(stripPrivateImageMetadata(input, "image/png", 6).kind, "fallback");
});
test("GIF uses existing sanitized synchronous encoder", async () => {
  assert.equal(stripPrivateImageMetadata(await picture().gif().toBuffer(), "image/gif", 1).kind, "fallback");
});
test("PNG CRC corruption and a forged format cannot enter fast path", async () => {
  const input = await picture().png().toBuffer();
  const corrupt = Buffer.from(input); corrupt[29] ^= 1;
  assert.throws(() => stripPrivateImageMetadata(corrupt, "image/png"));
  assert.throws(() => stripPrivateImageMetadata(input, "image/jpeg"));
});
test("oversized pixel headers are rejected without decoding a huge image", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "pad-image-large-"));
  try {
    const input = await picture().png().toBuffer();
    input.writeUInt32BE(100000, 16); input.writeUInt32BE(100000, 20);
    const incoming = path.join(directory, "input.png");
    await writeFile(incoming, input);
    await assert.rejects(prepareInitialImage(incoming, directory, "image.png"));
  } finally { await rm(directory, { recursive: true, force: true }); }
});
test("intake serves actual JPEG and display dimensions, and cleanup removes only its output", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "pad-image-intake-"));
  const previous = process.env.UPLOAD_DIR;
  process.env.UPLOAD_DIR = directory;
  try {
    const incoming = path.join(directory, "input.uploading");
    await writeFile(incoming, await picture().jpeg().withMetadata({ orientation: 6 }).toBuffer());
    const result = await prepareInitialImage(incoming, directory, "photo.jpg");
    assert.equal(result.data.mimeType, "image/jpeg");
    assert.equal(result.data.width, 12);
    assert.equal(result.data.height, 16);
    assert.match(result.data.storedName, /\.jpg$/);
    assert.equal((await sharp(await readFile(path.join(directory, result.data.storagePath))).metadata()).format, "jpeg");
    await result.cleanup();
    await assert.rejects(readFile(path.join(directory, result.data.storagePath)), { code: "ENOENT" });
    assert((await readFile(incoming)).length > 0);
  } finally {
    if (previous === undefined) delete process.env.UPLOAD_DIR; else process.env.UPLOAD_DIR = previous;
    await rm(directory, { recursive: true, force: true });
  }
});
