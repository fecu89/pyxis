import "../lib/load-env";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { getPrisma } from "../lib/prisma";
import { createPadActivity } from "./fixtures";

// 패드·퀴즈의 "삭제"는 소프트 삭제(deletedAt)라 Notification에 걸린 onDelete: Cascade가 절대
// 발동하지 않습니다. 그래서 알림 목록은 대상이 살아 있는지를 직접 걸러야 하는데, 이 조건이
// Prisma에서 의도대로 도는지가 유일한 위험 지점입니다 — 특히 옵셔널 관계에 건
// `board: { deletedAt: null }`이 "보드 없음"까지 삼켜 버리면 시스템 알림이 통째로 사라집니다.
//
// app/api/notifications/route.ts의 조건과 같은 모양을 여기에 두고 실제 행으로 검증합니다.
function visibleWhere(userId: string) {
  return {
    userId,
    AND: [
      { OR: [{ boardId: null }, { board: { deletedAt: null } }] },
      { OR: [{ quizId: null }, { quiz: { deletedAt: null } }] },
    ],
  };
}

async function main() {
  const prisma = getPrisma();
  const owner = await prisma.user.findFirst({
    where: { role: { in: ["TEACHER", "SUPER_ADMIN"] }, status: "ACTIVE" },
    orderBy: { role: "asc" },
    select: { id: true },
  });
  assert.ok(owner, "검증용 활성 교사 또는 전체관리자가 필요합니다.");

  const tag = randomUUID().slice(0, 8);
  const activityId = await createPadActivity(prisma, owner.id, `알림검증 ${tag}`);
  const board = await prisma.board.create({
    data: { slug: `verify-noti-${tag}`, title: `알림검증 ${tag}`, activityId, ownerId: owner.id },
    select: { id: true },
  });
  const quiz = await prisma.quiz.create({ data: { ownerId: owner.id, title: `알림검증 ${tag}` }, select: { id: true } });

  const boardNotification = await prisma.notification.create({
    data: { userId: owner.id, type: "MEMBER_JOINED", boardId: board.id },
    select: { id: true },
  });
  const quizNotification = await prisma.notification.create({
    data: { userId: owner.id, type: "QUIZ_SHARED", quizId: quiz.id },
    select: { id: true },
  });
  // 대상이 아예 없는 알림(교사 승인 등)은 어떤 경우에도 가려지면 안 됩니다.
  const plainNotification = await prisma.notification.create({
    data: { userId: owner.id, type: "TEACHER_APPROVAL_APPROVED" },
    select: { id: true },
  });

  const ids = [boardNotification.id, quizNotification.id, plainNotification.id];
  async function visibleIds() {
    const rows = await prisma.notification.findMany({
      where: { AND: [visibleWhere(owner!.id), { id: { in: ids } }] },
      select: { id: true },
    });
    return new Set(rows.map((row) => row.id));
  }
  async function unreadCount() {
    return prisma.notification.count({ where: { AND: [visibleWhere(owner!.id), { id: { in: ids } }, { readAt: null }] } });
  }

  try {
    let seen = await visibleIds();
    assert.equal(seen.size, 3, "삭제 전에는 세 알림이 모두 보여야 합니다.");
    assert.equal(await unreadCount(), 3, "삭제 전 안 읽음 수가 3이어야 합니다.");

    // 패드 보관(소프트 삭제) → 해당 알림만 사라지고 나머지는 그대로여야 합니다.
    await prisma.board.update({ where: { id: board.id }, data: { deletedAt: new Date() } });
    seen = await visibleIds();
    assert.ok(!seen.has(boardNotification.id), "보관된 패드의 알림이 그대로 보입니다.");
    assert.ok(seen.has(quizNotification.id), "패드 보관이 퀴즈 알림까지 가렸습니다.");
    assert.ok(seen.has(plainNotification.id), "패드 보관이 대상 없는 알림까지 가렸습니다.");
    assert.equal(await unreadCount(), 2, "가려진 알림이 안 읽음 수에 계속 잡힙니다.");

    // 패드는 7일 안에 복원할 수 있습니다. 복원하면 알림도 같이 돌아와야 합니다.
    await prisma.board.update({ where: { id: board.id }, data: { deletedAt: null } });
    seen = await visibleIds();
    assert.ok(seen.has(boardNotification.id), "패드를 복원했는데 알림이 돌아오지 않습니다.");
    assert.equal(await unreadCount(), 3, "복원 후 안 읽음 수가 3으로 돌아와야 합니다.");

    // 퀴즈는 삭제 시 알림을 함께 지우지만, 그 규칙 이전에 쌓인 행은 같은 조건으로 가려집니다.
    await prisma.quiz.update({ where: { id: quiz.id }, data: { deletedAt: new Date() } });
    seen = await visibleIds();
    assert.ok(!seen.has(quizNotification.id), "삭제된 퀴즈의 알림이 그대로 보입니다.");
    assert.ok(seen.has(boardNotification.id), "퀴즈 삭제가 패드 알림까지 가렸습니다.");
    assert.ok(seen.has(plainNotification.id), "퀴즈 삭제가 대상 없는 알림까지 가렸습니다.");

    // 퀴즈 DELETE 라우트가 하는 정리(같은 트랜잭션의 deleteMany)와 같은 조건입니다.
    const removed = await prisma.notification.deleteMany({ where: { quizId: quiz.id } });
    assert.equal(removed.count, 1, "퀴즈 알림 정리가 대상을 못 찾았습니다.");

    console.log("notification_visibility_checks=passed");
  } finally {
    await prisma.notification.deleteMany({ where: { id: { in: ids } } });
    await prisma.quiz.delete({ where: { id: quiz.id } }).catch(() => undefined);
    await prisma.board.delete({ where: { id: board.id } }).catch(() => undefined);
    await prisma.activity.delete({ where: { id: activityId } }).catch(() => undefined);
    await prisma.$disconnect();
  }
}

void main().catch((error) => {
  console.error(error);
  process.exit(1);
});
