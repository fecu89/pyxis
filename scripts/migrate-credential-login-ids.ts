import "../lib/load-env";
import { getPrisma } from "../lib/prisma";
import {
  createLoginIdentifierLookup,
  decryptUserLoginIdentifier,
  encryptUserLoginIdentifier,
  normalizeLoginIdentifier,
} from "../lib/security/pii-crypto-core";

const RESERVED_LOGIN_IDS = new Set([
  "admin", "administrator", "root", "system", "support", "help", "pyx", "pyxpad",
  "kakao", "teacher", "student", "school", "deleted", "null", "undefined",
]);
const LOGIN_ID_PATTERN = /^[a-z0-9]{3,20}$/u;

function isLoginId(value: string) {
  return LOGIN_ID_PATTERN.test(value);
}

function canCreatePublicStyleLoginId(value: string) {
  return isLoginId(value)
    && !RESERVED_LOGIN_IDS.has(value);
}

function baseLoginId(value: string) {
  const localPart = value.includes("@") ? value.slice(0, value.indexOf("@")) : value;
  const alphanumeric = normalizeLoginIdentifier(localPart).replace(/[^a-z0-9]/gu, "");
  const base = alphanumeric.length >= 3 ? alphanumeric : `user${alphanumeric}`;
  return base.slice(0, 20) || "user";
}

function uniqueLoginId(base: string, userId: string, occupied: Set<string>) {
  const suffixSource = userId.toLocaleLowerCase("en-US").replace(/[^a-z0-9]/gu, "");
  for (let length = 4; length <= Math.min(12, suffixSource.length); length += 2) {
    const suffix = suffixSource.slice(0, length);
    const candidate = `${base.slice(0, 20 - suffix.length)}${suffix}`;
    if (canCreatePublicStyleLoginId(candidate) && !occupied.has(createLoginIdentifierLookup(candidate))) return candidate;
  }
  throw new Error("기존 비밀번호 계정에 고유한 로그인 아이디를 만들지 못했습니다.");
}

async function main() {
  const prisma = getPrisma();
  const dryRun = process.argv.includes("--dry-run");
  const [credentialUsers, allLookups] = await Promise.all([
    prisma.user.findMany({
      where: { passwordHash: { not: null }, status: { not: "DELETED" } },
      orderBy: { createdAt: "asc" },
      select: { id: true, loginIdentifierEncrypted: true, loginIdentifierLookup: true },
    }),
    prisma.user.findMany({ select: { loginIdentifierLookup: true } }),
  ]);
  const occupied = new Set(allLookups.map(({ loginIdentifierLookup }) => loginIdentifierLookup));
  const changes: Array<{ userId: string; loginId: string; lookup: string }> = [];

  for (const user of credentialUsers) {
    const current = normalizeLoginIdentifier(decryptUserLoginIdentifier(user.id, user.loginIdentifierEncrypted));
    if (isLoginId(current)) continue;
    let loginId = baseLoginId(current);
    let lookup = createLoginIdentifierLookup(loginId);
    if (!canCreatePublicStyleLoginId(loginId) || occupied.has(lookup)) {
      loginId = uniqueLoginId(loginId, user.id, occupied);
      lookup = createLoginIdentifierLookup(loginId);
    }
    occupied.add(lookup);
    changes.push({ userId: user.id, loginId, lookup });
  }

  if (!dryRun && changes.length) {
    await prisma.$transaction(changes.map((change) => prisma.user.update({
      where: { id: change.userId },
      data: {
        loginIdentifierLookup: change.lookup,
        loginIdentifierEncrypted: encryptUserLoginIdentifier(change.userId, change.loginId),
        authVersion: { increment: 1 },
      },
      select: { id: true },
    })));
  }

  console.log(`credential_login_id_migration=${dryRun ? "dry-run" : "write"} checked=${credentialUsers.length} changed=${changes.length}`);
  if (changes.length) console.log(`new_login_ids=${changes.map(({ loginId }) => loginId).join(",")}`);
}

main()
  .catch((error) => {
    console.error(error instanceof Error ? error.message : "기존 비밀번호 계정 아이디 이전에 실패했습니다.");
    process.exitCode = 1;
  })
  .finally(async () => {
    await getPrisma().$disconnect();
  });
