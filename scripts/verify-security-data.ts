import "../lib/load-env";
import assert from "node:assert/strict";
import { getPrisma } from "../lib/prisma";
import { createLoginIdentifierLookup, decryptUserLoginIdentifier } from "../lib/security/pii-crypto-core";

async function main() {
  const prisma = getPrisma();
  const [plainColumns, activeSuperAdmins, unencryptedUsers, invalidPermissionOwners, studentsOverOwnershipLimit, invalidStudentElevatedMemberships, activeUsers] = await Promise.all([
    prisma.$queryRaw<{ count: bigint }[]>`
      SELECT COUNT(*)::bigint AS count
      FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = 'User' AND column_name IN ('email', 'name', 'image')
    `,
    prisma.user.count({ where: { role: "SUPER_ADMIN", status: "ACTIVE" } }),
    prisma.user.count({ where: { OR: [{ loginIdentifierEncrypted: "" }, { loginIdentifierLookup: "" }] } }),
    prisma.userSystemPermission.count({ where: { user: { role: { not: "ADMIN" } } } }),
    prisma.$queryRaw<{ count: bigint }[]>`
      SELECT COUNT(*)::bigint AS count
      FROM (
        SELECT b."ownerId"
        FROM "Board" b
        JOIN "User" u ON u.id = b."ownerId" AND u.role = 'STUDENT'
        GROUP BY b."ownerId"
        HAVING COUNT(*) > 10
      ) over_limit
    `,
    prisma.$queryRaw<{ count: bigint }[]>`
      SELECT COUNT(*)::bigint AS count
      FROM "BoardMember" m
      JOIN "User" u ON u.id = m."userId"
      JOIN "Board" b ON b.id = m."boardId"
      WHERE u.role = 'STUDENT'
        AND (m.role IN ('ADMIN', 'EDITOR') OR (m.role = 'OWNER' AND b."ownerId" <> m."userId"))
    `,
    prisma.user.findMany({
      where: { status: { not: "DELETED" } },
      select: { id: true, loginIdentifierEncrypted: true, loginIdentifierLookup: true, passwordHash: true },
    }),
  ]);

  assert.equal(Number(plainColumns[0]?.count ?? 0), 0, "User 평문 개인정보 컬럼이 남아 있습니다.");
  assert.ok(activeSuperAdmins >= 1, "활성 전체관리자가 한 명 이상 필요합니다.");
  assert.equal(unencryptedUsers, 0, "암호화 또는 검색값이 비어 있는 사용자가 있습니다.");
  assert.equal(invalidPermissionOwners, 0, "보조관리자가 아닌 사용자에게 시스템 권한 행이 있습니다.");
  assert.equal(Number(studentsOverOwnershipLimit[0]?.count ?? 0), 0, "학생의 패드 소유 한도 10개를 초과한 계정이 있습니다.");
  assert.equal(Number(invalidStudentElevatedMemberships[0]?.count ?? 0), 0, "학생에게 허용되지 않는 타인 패드 역할이 있습니다.");

  let invalidCredentialLoginIds = 0;
  let invalidKakaoEmails = 0;
  let invalidLoginLookups = 0;
  for (const user of activeUsers) {
    const loginIdentifier = decryptUserLoginIdentifier(user.id, user.loginIdentifierEncrypted);
    if (createLoginIdentifierLookup(loginIdentifier) !== user.loginIdentifierLookup) invalidLoginLookups += 1;
    if (user.passwordHash) {
      if (!/^[a-z0-9]{3,20}$/u.test(loginIdentifier)) invalidCredentialLoginIds += 1;
    } else if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/u.test(loginIdentifier)) {
      invalidKakaoEmails += 1;
    }
  }
  assert.equal(invalidCredentialLoginIds, 0, "일반 비밀번호 계정에 형식이 잘못된 loginId가 있습니다.");
  assert.equal(invalidKakaoEmails, 0, "카카오 계정에 이메일이 아닌 로그인 식별자가 있습니다.");
  assert.equal(invalidLoginLookups, 0, "로그인 식별자 암호문과 HMAC 조회 키가 일치하지 않는 사용자가 있습니다.");

  console.log(`security_data_checks=passed active_super_admins=${activeSuperAdmins}`);
}

main()
  .catch((error) => {
    console.error(error instanceof Error ? error.message : "보안 데이터 검증에 실패했습니다.");
    process.exitCode = 1;
  })
  .finally(async () => {
    await getPrisma().$disconnect();
  });
