import { mkdir, mkdtemp, open } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import type { PrismaClient } from "../generated/prisma/client";
import { decryptOptionalUserPii, encryptOptionalUserPii } from "../lib/security/pii-crypto-core";
import { resolveKakaoProfileImage } from "../lib/users/kakao-profile-image";
import { kakaoProfileImageUrl } from "../lib/users/profile-image-url";

export async function backfillProfileImages(
  prisma: PrismaClient,
  options: { apply?: boolean; backupDirectory?: string } = {},
) {
  const users = await prisma.user.findMany({
    where: { imageEncrypted: { not: null } },
    select: { id: true, imageEncrypted: true },
    orderBy: { id: "asc" },
  });
  const changes: { id: string; before: string; after: string | null }[] = [];
  const result = { candidates: 0, https: 0, fallback: 0, updated: 0, backupPath: null as string | null };
  for (const user of users) {
    const image = decryptOptionalUserPii(user.id, "image", user.imageEncrypted);
    if (!image || !/^http:\/\//i.test(image) || !kakaoProfileImageUrl(image) || !user.imageEncrypted) continue;
    const nextImage = await resolveKakaoProfileImage(image);
    const after = encryptOptionalUserPii(user.id, "image", nextImage);
    if (decryptOptionalUserPii(user.id, "image", after) !== nextImage) throw new Error("프로필 재암호화 검증 실패");
    changes.push({ id: user.id, before: user.imageEncrypted, after });
    result.candidates += 1;
    if (nextImage) result.https += 1;
    else result.fallback += 1;
  }
  if (!options.apply || !changes.length) return result;

  // URL·이름·이메일 대신 변경 전후 암호문만 기록합니다. 백업 실패 시 DB는 수정하지 않습니다.
  const backupDirectory = options.backupDirectory ?? join(homedir(), ".local/state/pyxis/profile-image-backups");
  await mkdir(backupDirectory, { recursive: true, mode: 0o700 });
  const directory = await mkdtemp(join(backupDirectory, "migration-"));
  result.backupPath = join(directory, "images.json");
  const file = await open(result.backupPath, "wx", 0o600);
  try {
    await file.writeFile(JSON.stringify({ version: 1, createdAt: new Date().toISOString(), changes }));
    await file.sync();
  } finally {
    await file.close();
  }

  await prisma.$transaction(async (tx) => {
    for (const change of changes) {
      const updated = await tx.user.updateMany({
        where: { id: change.id, imageEncrypted: change.before },
        data: { imageEncrypted: change.after },
      });
      if (updated.count !== 1) throw new Error("프로필이 동시에 변경되어 전체 작업을 취소했습니다. 다시 검사해 주세요.");
    }
  }, { timeout: 15_000 });
  result.updated = changes.length;
  return result;
}

async function main() {
  const args = process.argv.slice(2);
  if (args.some(arg => arg !== "--apply" && arg !== "--dry-run") || args.length > 1) {
    throw new Error("사용법: yarn db:backfill-profile-images [--dry-run | --apply] (기본: dry-run)");
  }
  await import("../lib/load-env");
  const { getPrisma } = await import("../lib/prisma");
  const prisma = getPrisma();
  try {
    console.log(JSON.stringify({ mode: args.includes("--apply") ? "apply" : "dry-run", ...await backfillProfileImages(prisma, { apply: args.includes("--apply") }) }));
  } finally {
    await prisma.$disconnect();
  }
}

if (process.argv[1]?.endsWith("/backfill-profile-images.ts")) {
  main().catch(() => {
    // 원본 URL이나 DB 연결 정보가 에러 메시지로 노출되지 않도록 합니다.
    console.error("프로필 이미지 보정 실패. 백업과 동시 수정 여부를 확인한 뒤 다시 실행하세요.");
    process.exitCode = 1;
  });
}
