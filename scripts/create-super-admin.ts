// 개발용 전체관리자 계정을 만듭니다.
//
// 운영에서는 BOOTSTRAP_SUPER_ADMIN_EMAIL과 일치하는 이메일로 카카오 첫 로그인을 하면 자동으로
// SUPER_ADMIN이 됩니다. 개발 DB를 새로 만들면 그 경로를 쓸 수 없어(카카오 로그인이 필요) 관리
// 화면에 아무도 들어갈 수 없으므로, 아이디·비밀번호 계정을 직접 만들어 둡니다.
//
//   npx tsx scripts/create-super-admin.ts <loginId> <password>
//   npx tsx scripts/create-super-admin.ts            # 기본값 pyxadmin / 무작위 비밀번호
//
// 이미 같은 아이디가 있으면 역할만 SUPER_ADMIN으로 올리고 비밀번호는 건드리지 않습니다.

import "../lib/load-env";
import { randomUUID, randomBytes } from "node:crypto";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../generated/prisma/client";
import {
  createLoginIdentifierLookup,
  createNicknameLookup,
  encryptOptionalUserPii,
  encryptUserLoginIdentifier,
  normalizeLoginIdentifier,
} from "../lib/security/pii-crypto-core";
import { hashUserPassword } from "../lib/auth/password";

const connectionString = process.env.DATABASE_URL;
if (!connectionString) throw new Error("DATABASE_URL 환경 변수가 필요합니다.");

const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString }) });

// 로그인 아이디 규칙은 lib/auth/credentials.ts와 같습니다 — 영문 소문자·숫자 3~20자.
// "admin" 등은 lib/auth/registration.ts의 예약어라 기본값으로 쓰지 않습니다.
const loginId = normalizeLoginIdentifier(process.argv[2] ?? "pyxadmin");
const password = process.argv[3] ?? `Dev${randomBytes(6).toString("base64url")}!1`;
const nickname = "전체관리자";

async function main() {
  if (!/^[a-z0-9]{3,20}$/u.test(loginId)) {
    throw new Error(`아이디는 영문 소문자와 숫자 3~20자여야 합니다: ${loginId}`);
  }

  const loginIdentifierLookup = createLoginIdentifierLookup(loginId);
  const existing = await prisma.user.findUnique({
    where: { loginIdentifierLookup },
    select: { id: true, role: true },
  });

  if (existing) {
    await prisma.user.update({
      where: { id: existing.id },
      // authVersion을 올려 역할이 바뀐 기존 세션을 무효화합니다.
      data: { role: "SUPER_ADMIN", status: "ACTIVE", authVersion: { increment: 1 } },
    });
    console.log(`기존 계정 ${loginId}의 역할을 SUPER_ADMIN으로 올렸습니다(비밀번호는 그대로).`);
    return;
  }

  const id = randomUUID();
  await prisma.user.create({
    data: {
      id,
      loginIdentifierLookup,
      loginIdentifierEncrypted: encryptUserLoginIdentifier(id, loginId),
      passwordHash: await hashUserPassword(password),
      // 관리자는 학교에 속하지 않습니다. 학교 단위 닉네임 유일성 제약은 schoolId가 null이면
      // 걸리지 않으므로(PostgreSQL이 null을 서로 다른 값으로 봄) 여기서는 문제되지 않습니다.
      nameEncrypted: encryptOptionalUserPii(id, "name", nickname),
      nameLookup: createNicknameLookup(nickname),
      role: "SUPER_ADMIN",
      status: "ACTIVE",
      mustChangePassword: false,
      onboardingCompletedAt: new Date(),
    },
  });

  console.log("전체관리자 계정을 만들었습니다.");
  console.log(`  아이디   ${loginId}`);
  console.log(`  비밀번호 ${password}`);
  console.log(`  사용자 ID ${id}`);
}

main()
  .then(() => prisma.$disconnect().then(() => process.exit(0)))
  .catch(async (error) => {
    console.error(error);
    await prisma.$disconnect();
    process.exit(1);
  });
