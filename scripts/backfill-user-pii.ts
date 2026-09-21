
import "../lib/load-env";
import { getPrisma } from "../lib/prisma";
import {
  createLoginIdentifierLookup,
  decryptOptionalUserPii,
  decryptUserPii,
  encryptOptionalUserPii,
  encryptUserPii,
  normalizeEmail,
} from "../lib/security/pii-crypto-core";

type LegacyUser = {
  id: string;
  email: string | null;
  name: string | null;
  image: string | null;
  loginIdentifierEncrypted: string | null;
  loginIdentifierLookup: string | null;
  nameEncrypted: string | null;
  imageEncrypted: string | null;
};

async function main() {
  const prisma = getPrisma();
  const dryRun = process.argv.includes("--dry-run");
  const column = await prisma.$queryRaw<{ exists: boolean }[]>`
    SELECT EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = 'User' AND column_name = 'email'
    ) AS "exists"
  `;
  if (!column[0]?.exists) {
    const remaining = await prisma.$queryRaw<{ count: bigint }[]>`
      SELECT COUNT(*)::bigint AS count FROM "User" WHERE "loginIdentifierEncrypted" IS NULL OR "loginIdentifierLookup" IS NULL
    `;
    if (Number(remaining[0]?.count ?? 0)) throw new Error("암호화되지 않은 사용자 레코드가 남아 있습니다.");
    console.log("status=already_backfilled_and_plaintext_removed");
    return;
  }

  const users = await prisma.$queryRaw<LegacyUser[]>`
    SELECT id, email, name, image, "loginIdentifierEncrypted", "loginIdentifierLookup", "nameEncrypted", "imageEncrypted"
    FROM "User"
    ORDER BY id
  `;
  const boardOwners = new Set(
    (await prisma.board.findMany({ distinct: ["ownerId"], select: { ownerId: true } })).map(({ ownerId }) => ownerId),
  );
  const bootstrapEmail = process.env.BOOTSTRAP_SUPER_ADMIN_EMAIL;
  if (!bootstrapEmail) throw new Error("BOOTSTRAP_SUPER_ADMIN_EMAIL 환경 변수가 필요합니다.");
  const bootstrapLookup = createLoginIdentifierLookup(bootstrapEmail);
  let bootstrapMatches = 0;
  let verified = 0;

  for (const user of users) {
    if (!user.email) throw new Error("평문 이메일이 없는 미완료 사용자 레코드가 있습니다.");
    const email = normalizeEmail(user.email);
    const loginIdentifierLookup = createLoginIdentifierLookup(email);
    const isBootstrap = loginIdentifierLookup === bootstrapLookup;
    if (isBootstrap) bootstrapMatches += 1;
    const role = isBootstrap ? "SUPER_ADMIN" : boardOwners.has(user.id) ? "TEACHER" : "STUDENT";
    const encrypted = {
      loginIdentifierEncrypted: encryptUserPii(user.id, "email", email),
      loginIdentifierLookup,
      nameEncrypted: encryptOptionalUserPii(user.id, "name", user.name),
      imageEncrypted: encryptOptionalUserPii(user.id, "image", user.image),
      role,
    } as const;

    if (!dryRun) await prisma.user.update({ where: { id: user.id }, data: encrypted });
    if (decryptUserPii(user.id, "email", encrypted.loginIdentifierEncrypted) !== email) {
      throw new Error("이메일 암호화 검증에 실패했습니다.");
    }
    if (decryptOptionalUserPii(user.id, "name", encrypted.nameEncrypted) !== user.name) {
      throw new Error("이름 암호화 검증에 실패했습니다.");
    }
    if (decryptOptionalUserPii(user.id, "image", encrypted.imageEncrypted) !== user.image) {
      throw new Error("프로필 이미지 암호화 검증에 실패했습니다.");
    }
    verified += 1;
  }

  if (bootstrapMatches !== 1) throw new Error("초기 전체관리자 이메일과 일치하는 사용자가 정확히 한 명이어야 합니다.");
  if (!dryRun) {
    const missing = await prisma.$queryRaw<{ count: bigint }[]>`
      SELECT COUNT(*)::bigint AS count FROM "User" WHERE "loginIdentifierEncrypted" IS NULL OR "loginIdentifierLookup" IS NULL
    `;
    if (Number(missing[0]?.count ?? 0)) throw new Error("암호화 백필이 완료되지 않은 사용자가 있습니다.");
  }

  console.log(`mode=${dryRun ? "dry-run" : "write"}`);
  console.log(`users=${users.length}`);
  console.log(`verified=${verified}`);
  console.log(`bootstrap_matches=${bootstrapMatches}`);
}

main()
  .catch((error) => {
    console.error(error instanceof Error ? error.message : "개인정보 백필에 실패했습니다.");
    process.exitCode = 1;
  })
  .finally(async () => {
    await getPrisma().$disconnect();
  });
