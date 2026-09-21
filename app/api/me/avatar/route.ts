import { rename, unlink } from "node:fs/promises";
import sharp from "sharp";
import { requireActiveUser } from "@/lib/auth/authorization";
import { streamMultipartFile } from "@/lib/files/multipart";
import { getAvatarDirectory, getAvatarPath } from "@/lib/files/paths";
import { withImageProcessingSlot } from "@/lib/files/processing-queue";
import { maxUploadBytes, validateUploadedFile } from "@/lib/files/validation";
import { apiError, assertSameOrigin } from "@/lib/http";
import { getPrisma } from "@/lib/prisma";
import { encryptUserPii } from "@/lib/security/pii-crypto";
import { assertRateLimit } from "@/lib/security/rate-limit";

export const runtime = "nodejs";

export async function POST(request: Request) {
  let incomingPath: string | null = null;
  let processingPath: string | null = null;

  try {
    assertSameOrigin(request);
    const user = await requireActiveUser();
    // 프로필 사진도 sharp 변환을 타므로 반복 업로드로 이미지 처리 슬롯을 점유하지 못하게 합니다.
    assertRateLimit(request, {
      scope: "avatar-upload",
      userId: user.id,
      windowMs: 10 * 60_000,
      maxAttempts: 20,
      message: "프로필 사진을 너무 자주 변경했습니다. 잠시 후 다시 시도해 주세요.",
    });
    const directory = getAvatarDirectory(user.id);
    const uploaded = await streamMultipartFile(request, directory, await maxUploadBytes());
    incomingPath = uploaded.temporaryPath;
    const validated = await validateUploadedFile(uploaded);
    if (!validated.isImage) throw new Error("이미지 파일만 프로필 사진으로 올릴 수 있습니다.");

    const finalPath = getAvatarPath(user.id);
    processingPath = `${finalPath}.uploading`;
    await withImageProcessingSlot(() =>
      sharp(incomingPath!, { failOn: "error", limitInputPixels: 40_000_000 })
        .rotate()
        .resize({ width: 512, height: 512, fit: "cover", position: "attention" })
        .webp({ quality: 82, effort: 4 })
        .toFile(processingPath!),
    );
    await rename(/* turbopackIgnore: true */ processingPath, finalPath);
    processingPath = null;
    await unlink(/* turbopackIgnore: true */ incomingPath);
    incomingPath = null;

    const image = `/api/users/${user.id}/avatar?v=${Date.now()}`;
    await getPrisma().user.update({
      where: { id: user.id },
      data: { imageEncrypted: encryptUserPii(user.id, "image", image) },
    });
    return Response.json({ ok: true, image });
  } catch (error) {
    if (incomingPath) await unlink(/* turbopackIgnore: true */ incomingPath).catch(() => undefined);
    if (processingPath) await unlink(/* turbopackIgnore: true */ processingPath).catch(() => undefined);
    return apiError(error, "프로필 사진을 업로드하지 못했습니다.");
  }
}

export async function DELETE(request: Request) {
  try {
    assertSameOrigin(request);
    const user = await requireActiveUser();
    await unlink(/* turbopackIgnore: true */ getAvatarPath(user.id)).catch(() => undefined);
    await getPrisma().user.update({ where: { id: user.id }, data: { imageEncrypted: null } });
    return Response.json({ ok: true });
  } catch (error) {
    return apiError(error, "프로필 사진을 삭제하지 못했습니다.");
  }
}
