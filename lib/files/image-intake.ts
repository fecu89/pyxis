import { readFile, writeFile, unlink } from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";
import { createStoredFilename, normalizeOriginalFilename } from "@/lib/files/filename";
import { stripPrivateImageMetadata, type RasterMime } from "@/lib/files/image-metadata";
import { toStoragePath } from "@/lib/files/paths";

const formats: Record<string, { mime: RasterMime; extension: string }> = {
  jpeg: { mime: "image/jpeg", extension: ".jpg" }, png: { mime: "image/png", extension: ".png" },
  webp: { mime: "image/webp", extension: ".webp" }, gif: { mime: "image/gif", extension: ".gif" },
};

export async function prepareInitialImage(temporaryPath: string, directory: string, originalName: string) {
  const metadata = await sharp(temporaryPath, { failOn: "error", limitInputPixels: 40_000_000 }).metadata();
  const format = formats[metadata.format ?? ""];
  if (!format || !metadata.width || !metadata.height || metadata.width * metadata.height > 40_000_000) {
    throw new Error("지원하지 않거나 너무 큰 이미지입니다.");
  }
  if ((metadata.pages ?? 1) > 1) return null;
  const cleaned = stripPrivateImageMetadata(await readFile(temporaryPath), format.mime, metadata.orientation ?? 1);
  if (cleaned.kind === "fallback") return null;
  const storedName = `pending-${createStoredFilename(format.extension).storedName}`;
  const outputPath = path.join(/* turbopackIgnore: true */ directory, storedName);
  try {
    await writeFile(/* turbopackIgnore: true */ outputPath, cleaned.bytes, { flag: "wx" });
  } catch (error) {
    await unlink(/* turbopackIgnore: true */ outputPath).catch(() => undefined);
    throw error;
  }
  const swapped = cleaned.orientation >= 5;
  return {
    data: {
      type: "IMAGE" as const, originalName: normalizeOriginalFilename(originalName, format.extension), storedName,
      storagePath: toStoragePath(outputPath), thumbnailPath: null, mimeType: format.mime, fileSize: cleaned.bytes.length,
      width: swapped ? metadata.height : metadata.width, height: swapped ? metadata.width : metadata.height,
    },
    async cleanup() { await unlink(/* turbopackIgnore: true */ outputPath).catch(() => undefined); },
  };
}
