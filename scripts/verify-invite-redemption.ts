import "../lib/load-env";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { createPadActivity } from "./fixtures";
import { redeemInviteMembership } from "../lib/board/redeem-invite";
import { hashInviteToken } from "../lib/board/invite-links";
import { getPrisma } from "../lib/prisma";
import { createLoginIdentifierLookup, encryptUserPii } from "../lib/security/pii-crypto-core";

const prisma = getPrisma();
const userIds: string[] = [];
const activityIds: string[] = [];

async function createUser(name: string, role: "TEACHER" | "STUDENT") {
  const id = randomUUID();
  const login = `invite-verify-${id}@invalid.local`;
  userIds.push(id);
  return prisma.user.create({
    data: {
      id,
      loginIdentifierLookup: createLoginIdentifierLookup(login),
      loginIdentifierEncrypted: encryptUserPii(id, "email", login),
      nameEncrypted: encryptUserPii(id, "name", name),
      role,
      status: "ACTIVE",
    },
    select: { id: true },
  });
}

async function createBoard(ownerId: string, title: string) {
  const activityId = await createPadActivity(prisma, ownerId, title);
  activityIds.push(activityId);
  return prisma.board.create({
    data: {
      activityId,
      ownerId,
      slug: `invite-verify-${randomUUID()}`,
      title,
      members: { create: { userId: ownerId, role: "OWNER" } },
    },
    select: { id: true },
  });
}

async function createInvite(boardId: string, ownerId: string) {
  const tokenHash = hashInviteToken(randomUUID());
  const invite = await prisma.boardInviteLink.create({
    data: { boardId, createdById: ownerId, tokenHash, role: "MEMBER", maxUses: 1 },
    select: { id: true },
  });
  return { ...invite, tokenHash };
}

async function main() {
  const owner = await createUser("초대 검증 소유자", "TEACHER");
  const first = await createUser("초대 검증 참여자 1", "STUDENT");
  const second = await createUser("초대 검증 참여자 2", "STUDENT");

  const repeatBoard = await createBoard(owner.id, "초대 반복 검증");
  const repeatInvite = await createInvite(repeatBoard.id, owner.id);
  assert.equal((await redeemInviteMembership(repeatInvite.tokenHash, first.id)).ok, true);
  const repeated = await redeemInviteMembership(repeatInvite.tokenHash, first.id);
  assert.equal(repeated.ok, true, "이미 가입한 사용자는 만료된 사용 횟수 때문에 다시 열지 못하면 안 됩니다.");
  if (repeated.ok) assert.equal(repeated.membershipChanged, false);
  assert.equal((await prisma.boardInviteLink.findUniqueOrThrow({ where: { id: repeatInvite.id } })).useCount, 1);

  const raceBoard = await createBoard(owner.id, "초대 동시성 검증");
  const raceInvite = await createInvite(raceBoard.id, owner.id);
  const results = await Promise.all([
    redeemInviteMembership(raceInvite.tokenHash, first.id),
    redeemInviteMembership(raceInvite.tokenHash, second.id),
  ]);
  assert.equal(results.filter((result) => result.ok && result.membershipChanged).length, 1);
  assert.equal(results.filter((result) => !result.ok && result.status === 410).length, 1);
  assert.equal((await prisma.boardInviteLink.findUniqueOrThrow({ where: { id: raceInvite.id } })).useCount, 1);
  assert.equal(await prisma.boardMember.count({ where: { boardId: raceBoard.id, role: "MEMBER" } }), 1);

  console.log("invite_redemption_checks=passed replay=idempotent max_uses=atomic");
}

main()
  .finally(async () => {
    for (const activityId of activityIds.reverse()) {
      await prisma.activity.delete({ where: { id: activityId } }).catch(() => undefined);
    }
    await prisma.user.deleteMany({ where: { id: { in: userIds } } });
    await prisma.$disconnect();
  });
