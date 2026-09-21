import "../lib/load-env";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { getPrisma } from "../lib/prisma";
import { succeedOwnedBoards } from "../lib/board/succession";
import { createLoginIdentifierLookup, encryptOptionalUserPii, encryptUserPii } from "../lib/security/pii-crypto-core";
import { createPadActivity } from "./fixtures";

const prisma = getPrisma();
const createdUserIds: string[] = [];
const createdBoardIds: string[] = [];
const createdSchoolIds: string[] = [];

async function makeUser(name: string, role: "TEACHER" | "STUDENT", schoolId: string | null, extra: { isSchoolRepresentative?: boolean; status?: "ACTIVE" | "SUSPENDED" } = {}) {
  const id = randomUUID();
  const identifier = `succession-${id}@invalid.local`;
  createdUserIds.push(id);
  return prisma.user.create({
    data: {
      id,
      loginIdentifierLookup: createLoginIdentifierLookup(identifier),
      loginIdentifierEncrypted: encryptUserPii(id, "email", identifier),
      nameEncrypted: encryptOptionalUserPii(id, "name", name),
      role,
      schoolId,
      status: extra.status ?? "ACTIVE",
      isSchoolRepresentative: extra.isSchoolRepresentative ?? false,
    },
    select: { id: true, schoolId: true },
  });
}

async function makeBoard(ownerId: string, title: string, trashed = false) {
  const board = await prisma.board.create({
    data: {
      slug: `succession-${randomUUID()}`,
      title,
      ownerId,
      activityId: await createPadActivity(prisma, ownerId, title),
      deletedAt: trashed ? new Date() : null,
      members: { create: { userId: ownerId, role: "OWNER" } },
    },
    select: { id: true },
  });
  createdBoardIds.push(board.id);
  return board;
}

async function main() {
  const schoolId = `school_succession_${randomUUID()}`;
  createdSchoolIds.push(schoolId);
  await prisma.school.create({ data: { id: schoolId, name: "승계검증고등학교" } });

  // 1) 패드 ADMIN 멤버가 있으면 그 사람이 승계받습니다(가장 오래 참여한 활성 사용자).
  {
    const owner = await makeUser("떠나는 교사", "TEACHER", schoolId);
    const late = await makeUser("나중에 합류한 교사", "TEACHER", schoolId);
    const early = await makeUser("먼저 합류한 교사", "TEACHER", schoolId);
    const board = await makeBoard(owner.id, "ADMIN 승계 패드");
    await prisma.boardMember.create({ data: { boardId: board.id, userId: late.id, role: "ADMIN", joinedAt: new Date(Date.now() - 1_000) } });
    await prisma.boardMember.create({ data: { boardId: board.id, userId: early.id, role: "ADMIN", joinedAt: new Date(Date.now() - 60_000) } });

    const [result] = await prisma.$transaction((tx) => succeedOwnedBoards(tx, owner.id, owner.schoolId));
    assert.equal(result.outcome, "ADMIN_MEMBER");
    assert.equal(result.successorId, early.id, "가장 오래 참여한 ADMIN이 승계받아야 합니다");
    const after = await prisma.board.findUniqueOrThrow({ where: { id: board.id }, select: { ownerId: true, state: true } });
    assert.equal(after.ownerId, early.id);
    assert.equal(after.state, "ACTIVE", "승계에 성공한 패드는 얼리지 않습니다");
    const membership = await prisma.boardMember.findUniqueOrThrow({ where: { boardId_userId: { boardId: board.id, userId: early.id } }, select: { role: true } });
    assert.equal(membership.role, "OWNER", "승계자는 OWNER 멤버십을 가져야 합니다");
    console.log("✓ 1. 패드 ADMIN 멤버가 승계받는다 (가장 오래 참여한 사람)");
  }

  // 2) ADMIN 멤버가 없으면 학교 대표교사가 승계받습니다.
  {
    const owner = await makeUser("떠나는 교사2", "TEACHER", schoolId);
    const representative = await makeUser("대표교사", "TEACHER", schoolId, { isSchoolRepresentative: true });
    const board = await makeBoard(owner.id, "대표교사 승계 패드");

    const [result] = await prisma.$transaction((tx) => succeedOwnedBoards(tx, owner.id, owner.schoolId));
    assert.equal(result.outcome, "SCHOOL_REPRESENTATIVE");
    assert.equal(result.successorId, representative.id);
    const after = await prisma.board.findUniqueOrThrow({ where: { id: board.id }, select: { ownerId: true, state: true } });
    assert.equal(after.ownerId, representative.id);
    assert.equal(after.state, "ACTIVE");
    console.log("✓ 2. ADMIN이 없으면 학교 대표교사가 승계받는다");
  }

  // 3) 후보가 아무도 없으면 소유자를 비우고 FROZEN으로 얼립니다(내용은 그대로 남습니다).
  {
    const owner = await makeUser("고아 패드 소유자", "TEACHER", null);
    const board = await makeBoard(owner.id, "고아 패드");

    const [result] = await prisma.$transaction((tx) => succeedOwnedBoards(tx, owner.id, owner.schoolId));
    assert.equal(result.outcome, "ORPHANED_FROZEN");
    assert.equal(result.successorId, null);
    const after = await prisma.board.findUniqueOrThrow({ where: { id: board.id }, select: { ownerId: true, state: true, deletedAt: true } });
    assert.equal(after.ownerId, null);
    assert.equal(after.state, "FROZEN", "주인 없는 패드는 읽기 전용으로 얼려야 합니다");
    assert.equal(after.deletedAt, null, "패드를 같이 지우면 안 됩니다");
    console.log("✓ 3. 후보가 없으면 소유자를 비우고 FROZEN — 패드는 지우지 않는다");
  }

  // 4) 비활성(정지) 사용자는 승계 후보가 될 수 없습니다.
  {
    const owner = await makeUser("떠나는 교사3", "TEACHER", null);
    const suspended = await makeUser("정지된 교사", "TEACHER", null, { status: "SUSPENDED" });
    const board = await makeBoard(owner.id, "정지 후보 패드");
    await prisma.boardMember.create({ data: { boardId: board.id, userId: suspended.id, role: "ADMIN" } });

    const [result] = await prisma.$transaction((tx) => succeedOwnedBoards(tx, owner.id, owner.schoolId));
    assert.equal(result.outcome, "ORPHANED_FROZEN", "정지된 사용자는 승계받으면 안 됩니다");
    console.log("✓ 4. 정지된 사용자는 승계 후보에서 제외된다");
  }

  // 5) 휴지통 패드는 소유자만 비우고 얼리지 않습니다(이미 아무도 못 씁니다).
  {
    const owner = await makeUser("떠나는 교사4", "TEACHER", null);
    const board = await makeBoard(owner.id, "휴지통 패드", true);

    const [result] = await prisma.$transaction((tx) => succeedOwnedBoards(tx, owner.id, owner.schoolId));
    assert.equal(result.outcome, "ORPHANED_TRASHED");
    const after = await prisma.board.findUniqueOrThrow({ where: { id: board.id }, select: { ownerId: true, state: true } });
    assert.equal(after.ownerId, null);
    assert.equal(after.state, "ACTIVE", "휴지통 패드는 얼릴 필요가 없습니다");
    console.log("✓ 5. 휴지통 패드는 소유자만 비운다");
  }

  // 6) 여러 패드를 한 번에, 각각 다른 결과로 처리합니다.
  {
    const owner = await makeUser("패드 많은 교사", "TEACHER", schoolId);
    const admin = await makeUser("공동 관리 교사", "TEACHER", schoolId);
    const withAdmin = await makeBoard(owner.id, "관리자 있는 패드");
    await prisma.boardMember.create({ data: { boardId: withAdmin.id, userId: admin.id, role: "ADMIN" } });
    await makeBoard(owner.id, "관리자 없는 패드");

    const results = await prisma.$transaction((tx) => succeedOwnedBoards(tx, owner.id, owner.schoolId));
    assert.equal(results.length, 2);
    // 이 학교에는 2번에서 만든 대표교사가 있으므로 ADMIN이 없는 패드도 대표교사가 받습니다.
    assert.deepEqual(results.map((item) => item.outcome).sort(), ["ADMIN_MEMBER", "SCHOOL_REPRESENTATIVE"]);
    const remaining = await prisma.board.count({ where: { ownerId: owner.id } });
    assert.equal(remaining, 0, "떠나는 소유자에게 남은 패드가 없어야 합니다");
    console.log("✓ 6. 패드 여러 개를 각각 다른 결과로 한 번에 처리한다");
  }

  console.log("\n소유권 승계 검증 6개 모두 통과");
}

async function cleanup() {
  await prisma.boardMember.deleteMany({ where: { boardId: { in: createdBoardIds } } });
  await prisma.activity.deleteMany({ where: { board: { id: { in: createdBoardIds } } } });
  await prisma.user.deleteMany({ where: { id: { in: createdUserIds } } });
  await prisma.school.deleteMany({ where: { id: { in: createdSchoolIds } } });
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await cleanup();
    await prisma.$disconnect();
  });
