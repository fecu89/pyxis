import { mkdir, rename, unlink, stat } from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";
import { resolveStoredFile, toStoragePath } from "@/lib/files/paths";
import { withImageProcessingSlot } from "@/lib/files/processing-queue";

export type ImageOutput = { storagePath: string; thumbnailPath: string; storedName: string;
  fileSize: number; width: number; height: number };

export async function transformImage(inputPath: string, outputStem: string): Promise<ImageOutput> {
  const output = resolveStoredFile(`${outputStem}.webp`);
  const thumbnail = resolveStoredFile(`${outputStem}.thumb.webp`);
  try {
    await mkdir(/* turbopackIgnore: true */ path.dirname(output), { recursive: true });
    const info = await withImageProcessingSlot(async () => {
      const converted = await sharp(resolveStoredFile(inputPath), { failOn: "error", limitInputPixels: 40_000_000 })
        .rotate().resize({ width: 2560, height: 2560, fit: "inside", withoutEnlargement: true })
        .webp({ quality: 82, effort: 4 }).toFile(`${output}.uploading`);
      await sharp(`${output}.uploading`, { failOn: "error" })
        .resize({ width: 960, height: 960, fit: "inside", withoutEnlargement: true })
        .webp({ quality: 76, effort: 3 }).toFile(`${thumbnail}.uploading`);
      return converted;
    });
    await rename(/* turbopackIgnore: true */ `${output}.uploading`, output);
    await rename(/* turbopackIgnore: true */ `${thumbnail}.uploading`, thumbnail);
    return { storagePath: toStoragePath(output), thumbnailPath: toStoragePath(thumbnail),
      storedName: path.basename(output), fileSize: (await stat(/* turbopackIgnore: true */ output)).size,
      width: info.width, height: info.height };
  } catch (error) {
    for (const file of [output, thumbnail, `${output}.uploading`, `${thumbnail}.uploading`]) {
      await unlink(/* turbopackIgnore: true */ file).catch(() => undefined);
    }
    throw error;
  }
}
