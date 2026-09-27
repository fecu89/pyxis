/** Container-only sanitizing: compressed pixels are never decoded/re-encoded here. */
export type RasterMime = "image/jpeg" | "image/png" | "image/webp" | "image/gif";
type CleanImage = { kind: "ready"; bytes: Buffer; mimeType: RasterMime; orientation: number }
  | { kind: "fallback"; reason: "animation" | "unsupported-container" };
const invalid = () => new Error("이미지 파일 구조가 올바르지 않습니다.");

function jpeg(bytes: Buffer, orientation: number) {
  if (bytes.readUInt16BE(0) !== 0xffd8) throw invalid();
  const chunks = [bytes.subarray(0, 2)];
  if (orientation !== 1) {
    // New EXIF containing ONLY orientation, never a copy of the uploader's TIFF tree.
    const exif = Buffer.from("ffe100224578696600004d4d002a00000008000101120003000000010001000000000000", "hex");
    exif.writeUInt16BE(orientation, 28);
    chunks.push(exif);
  }
  let offset = 2;
  let scanned = false;
  while (offset < bytes.length) {
    const start = offset;
    if (bytes[offset++] !== 0xff) throw invalid();
    while (bytes[offset] === 0xff) offset++;
    const marker = bytes[offset++];
    if (marker === 0xd9) {
      if (!scanned) throw invalid();
      chunks.push(Buffer.from([0xff, 0xd9]));
      return Buffer.concat(chunks); // Discard anything after EOI.
    }
    if (offset + 2 > bytes.length) throw invalid();
    const length = bytes.readUInt16BE(offset);
    const end = offset + length;
    if (length < 2 || end > bytes.length) throw invalid();
    const payload = bytes.subarray(offset + 2, end);
    if (marker >= 0xe0 && marker <= 0xef) {
      if (marker === 0xe0 && payload.length >= 14 && payload.subarray(0, 5).equals(Buffer.from("JFIF\0"))) {
        const jfif = Buffer.from(payload.subarray(0, 14));
        jfif[12] = 0; jfif[13] = 0; // No embedded thumbnail (may contain private content).
        chunks.push(Buffer.from([0xff, 0xe0, 0, 16]), jfif);
      } else if (marker === 0xe2 && payload.subarray(0, 12).equals(Buffer.from("ICC_PROFILE\0"))) {
        chunks.push(bytes.subarray(start, end));
      } else if (marker === 0xee && payload.length === 12 && payload.subarray(0, 5).toString() === "Adobe") {
        chunks.push(bytes.subarray(start, end));
      }
    } else if (marker !== 0xfe) {
      if (![0xc0, 0xc1, 0xc2, 0xc4, 0xdb, 0xdd, 0xda].includes(marker)) throw invalid();
      chunks.push(bytes.subarray(start, end));
    }
    offset = end;
    if (marker === 0xda) {
      scanned = true;
      const scanStart = offset;
      while (offset < bytes.length) {
        if (bytes[offset] !== 0xff) { offset++; continue; }
        const next = bytes[offset + 1];
        if (next === 0 || (next >= 0xd0 && next <= 0xd7)) { offset += 2; continue; }
        break;
      }
      chunks.push(bytes.subarray(scanStart, offset));
    }
  }
  throw invalid();
}

const crcTable = Array.from({ length: 256 }, (_, value) => {
  let crc = value;
  for (let bit = 0; bit < 8; bit++) crc = crc & 1 ? 0xedb88320 ^ (crc >>> 1) : crc >>> 1;
  return crc >>> 0;
});
function crc32(bytes: Buffer) {
  let crc = 0xffffffff;
  for (const byte of bytes) crc = crcTable[(crc ^ byte) & 255] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}
function png(bytes: Buffer): Buffer | null {
  if (!bytes.subarray(0, 8).equals(Buffer.from("89504e470d0a1a0a", "hex"))) throw invalid();
  const chunks = [bytes.subarray(0, 8)];
  let imageData = false;
  let offset = 8;
  while (offset + 12 <= bytes.length) {
    const length = bytes.readUInt32BE(offset);
    const end = offset + length + 12;
    if (end > bytes.length) throw invalid();
    const type = bytes.toString("ascii", offset + 4, offset + 8);
    if (crc32(bytes.subarray(offset + 4, end - 4)) !== bytes.readUInt32BE(end - 4)) throw invalid();
    if (offset === 8 && (type !== "IHDR" || length !== 13)) throw invalid();
    if (type === "acTL") return null;
    if (["IHDR", "PLTE", "IDAT", "IEND", "tRNS", "cHRM", "gAMA", "iCCP", "sBIT", "sRGB"].includes(type)) {
      chunks.push(bytes.subarray(offset, end));
    } else if ((bytes[offset + 4] & 32) === 0) throw invalid();
    if (type === "IDAT") imageData = true;
    if (type === "IEND") {
      if (!imageData || length !== 0) throw invalid();
      return Buffer.concat(chunks);
    }
    offset = end;
  }
  throw invalid();
}
function webp(bytes: Buffer): Buffer | null {
  if (bytes.toString("ascii", 0, 4) !== "RIFF" || bytes.toString("ascii", 8, 12) !== "WEBP"
    || bytes.readUInt32LE(4) + 8 !== bytes.length) throw invalid();
  const chunks: Buffer[] = [];
  let offset = 12;
  let frames = 0;
  while (offset + 8 <= bytes.length) {
    const type = bytes.toString("ascii", offset, offset + 4);
    const length = bytes.readUInt32LE(offset + 4);
    const end = offset + 8 + length + (length % 2);
    if (end > bytes.length || (length % 2 && bytes[end - 1] !== 0)) throw invalid();
    if (type === "ANIM" || type === "ANMF") return null;
    if (["VP8X", "ICCP", "ALPH", "VP8 ", "VP8L"].includes(type)) {
      const chunk = Buffer.from(bytes.subarray(offset, end));
      if (type === "VP8X") {
        if (length !== 10 || offset !== 12) throw invalid();
        if (chunk[8] & 2) return null;
        chunk[8] &= ~12; // Clear EXIF (8) and XMP (4) feature bits.
      }
      if (type === "VP8 " || type === "VP8L") frames++;
      chunks.push(chunk);
    }
    offset = end;
  }
  if (offset !== bytes.length || frames !== 1) throw invalid();
  const payload = Buffer.concat(chunks);
  const header = Buffer.from(bytes.subarray(0, 12));
  header.writeUInt32LE(payload.length + 4, 4);
  return Buffer.concat([header, payload]);
}

export function stripPrivateImageMetadata(bytes: Buffer, mimeType: RasterMime, orientation = 1): CleanImage {
  if (bytes.length < 12 || !Number.isInteger(orientation) || orientation < 1 || orientation > 8) throw invalid();
  if (mimeType === "image/gif") return { kind: "fallback", reason: "animation" };
  if (mimeType !== "image/jpeg" && orientation !== 1) return { kind: "fallback", reason: "unsupported-container" };
  const cleaned = mimeType === "image/jpeg" ? jpeg(bytes, orientation)
    : mimeType === "image/png" ? png(bytes) : mimeType === "image/webp" ? webp(bytes) : undefined;
  if (cleaned === undefined) throw invalid();
  return cleaned === null ? { kind: "fallback", reason: "animation" }
    : { kind: "ready", bytes: cleaned, mimeType, orientation };
}
