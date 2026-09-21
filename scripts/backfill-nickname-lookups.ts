import "../lib/load-env";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../generated/prisma/client";
import {
  createNicknameLookup,
  decryptOptionalUserPii,
  normalizeNickname,
} from "../lib/security/pii-crypto-core";

const connectionString = process.env.DATABASE_URL;
if (!connectionString) throw new Error("DATABASE_URL 환경 변수가 필요합니다.");
const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString }) });

async function main() {
  const users = await prisma.user.findMany({
    where: { status: { not: "DELETED" }, nameEncrypted: { not: null } },
    select: { id: true, nameEncrypted: true },
    orderBy: { createdAt: "asc" },
  });
  const byLookup = new Map<string, string[]>();
  for (const user of users) {
    const name = decryptOptionalUserPii(user.id, "name", user.nameEncrypted);
    if (!name) continue;
    const lookup = createNicknameLookup(normalizeNickname(name));
    byLookup.set(lookup, [...(byLookup.get(lookup) ?? []), user.id]);
  }
  const duplicateGroups = [...byLookup.values()].filter((ids) => ids.length > 1);
  if (duplicateGroups.length) {
    throw new Error(`중복 닉네임 그룹 ${duplicateGroups.length}개가 있어 백필을 중단했습니다. 관리자 화면에서 닉네임을 먼저 정리해 주세요.`);
  }

  await prisma.$transaction([
    prisma.user.updateMany({ where: { status: "DELETED" }, data: { nameLookup: null } }),
    ...[...byLookup].map(([nameLookup, [id]]) => prisma.user.update({ where: { id }, data: { nameLookup } })),
  ]);
  console.log(`닉네임 HMAC ${byLookup.size}건을 백필했습니다.`);
}

main()
  .catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  })
  .finally(async () => prisma.$disconnect());
