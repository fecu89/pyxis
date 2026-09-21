import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { after, beforeEach, mock, test } from "node:test";
import type { NotificationType } from "../generated/prisma/client";
import type { getPrisma } from "../lib/prisma";
import { createNotification } from "../lib/notifications/create";
import { getNotificationList, getNotificationSummary } from "../lib/notifications/list";
import { markViewing } from "../lib/realtime/board-viewers";
import { subscribeUserEvent, type UserEvent } from "../lib/realtime/user-events";
import { encryptUserPii } from "../lib/security/pii-crypto-core";

// 실제 요청 API·알림 생성·접속 레지스트리·SSE·목록 변환을 실행합니다.
// DB/Next 인증 저장소만 대체하며 운영 DB나 실제 사용자에게는 접근하지 않습니다.
process.env.DATABASE_URL = "postgresql://test:test@127.0.0.1:1/unavailable";
process.env.AUTH_SECRET = "access-request-notification-test";
process.env.PII_ACTIVE_KEY_ID = "test";
process.env.PII_ENCRYPTION_KEY_TEST = Buffer.alloc(32, 1).toString("base64");
process.env.PII_LOOKUP_KEY = Buffer.alloc(32, 2).toString("base64");

const moduleRequire = createRequire(`${process.cwd()}/package.json`);
let sessionUserId = "requester";
mock.method(moduleRequire("next/headers"), "headers", async () => new Headers());
mock.method(moduleRequire("next-auth/next"), "getServerSession", async () => ({ user: { id: sessionUserId } }));

type NotificationInput = Parameters<typeof createNotification>[0];
const notifications: Array<NotificationInput & { id: string; readAt: null; createdAt: Date }> = [];
const board = {
  id: "test-board", slug: "test-pad", title: "접근 요청 테스트", ownerId: "owner",
  discoveryScope: "PRIVATE", visitorPermission: "NO_ACCESS", loginRequired: true,
  passwordHash: null, deletedAt: null, state: "ACTIVE", freezeAt: null, moderationMode: "NONE",
  guestPostsRequireApproval: true, allowMemberPosting: true, allowMemberFileUpload: true,
  allowComments: true, allowReactions: true, reactionPolicy: "SINGLE", attachmentDownloadPolicy: "READERS",
  owner: { id: "owner", role: "TEACHER", nameEncrypted: null, imageEncrypted: null }, members: [],
};
const accessRequests: Array<{ id: string; boardId: string; userId: string; status: string; updatedAt: Date }> = [];
const database = {
  user: { findUnique: async ({ where }: { where: { id: string } }) => ({
    id: where.id, loginIdentifierEncrypted: encryptUserPii(where.id, "email", `test-${where.id}`),
    nameEncrypted: null, imageEncrypted: null, role: "TEACHER", status: "ACTIVE",
    registrationApprovalStatus: "APPROVED", registrationReviewReason: null, registrationReviewedAt: null,
    authVersion: 0, passwordHash: "test-hash", mustChangePassword: false, studentNumber: null,
    onboardingCompletedAt: new Date(), createdAt: new Date(), lastLoginAt: null,
    systemPermissions: [], school: null, schoolGroup: null, isSchoolRepresentative: false,
  }) },
  board: {
    findFirst: async ({ where }: { where: { id: string } }) => where.id === board.id ? board : null,
    findMany: async ({ where }: { where: { id: { in: string[] } } }) => where.id.in.includes(board.id) ? [board] : [],
  },
  boardAccessRequest: { upsert: async ({ create }: { create: { boardId: string; userId: string; status: string } }) => {
    const row = { id: "access-request", ...create, updatedAt: new Date() };
    accessRequests.push(row);
    return row;
  } },
  boardMember: { findMany: async ({ where }: { where: { boardId: string; role: string } }) => {
    assert.deepEqual(where, { boardId: "test-board", role: "ADMIN" });
    // 소유자가 관리자 행에도 있어도 중복 발송하면 안 됩니다.
    return [{ userId: "owner" }, { userId: "admin" }];
  } },
  notification: {
    create: async ({ data }: { data: NotificationInput }) => {
      const row = { ...data, id: `notification-${notifications.length + 1}`, readAt: null, createdAt: new Date() };
      notifications.push(row);
      return { id: row.id };
    },
    count: async ({ where }: { where: { userId: string } }) => notifications.filter((item) => item.userId === where.userId).length,
    findMany: async ({ where, take }: { where: { userId: string }; take: number }) => notifications
      .filter((item) => item.userId === where.userId).slice(0, take)
      .map((item) => ({ quizId: null, formId: null, responseCount: null, actor: null, ...item })),
  },
};
const globals = globalThis as unknown as { pyxCoursePrisma?: ReturnType<typeof getPrisma> };
globals.pyxCoursePrisma = database as unknown as ReturnType<typeof getPrisma>;
beforeEach(() => { notifications.length = 0; accessRequests.length = 0; sessionUserId = "requester"; });
after(() => { mock.restoreAll(); delete globals.pyxCoursePrisma; });

for (const type of ["ACCESS_REQUEST_RECEIVED", "ACCESS_REQUEST_APPROVED", "ACCESS_REQUEST_REJECTED"] as const) {
  test(`${type}: 해당 패드를 보고 있어도 저장하고 개인 알림 이벤트를 보낸다`, async () => {
    const release = markViewing(board.id, "recipient");
    const events: UserEvent[] = [];
    const unsubscribe = subscribeUserEvent("recipient", (event) => events.push(event));
    try {
      await createNotification({ userId: "recipient", actorId: "requester", boardId: board.id, type, accessRequestId: "access-request" });
      assert.equal(notifications.length, 1, "화면을 보고 있다는 이유로 접근 요청 알림을 버리면 안 됩니다.");
      assert.equal(events.length, 1);
      assert.equal(events[0].type, "notification.created");
      assert.equal(events[0].notificationId, notifications[0].id);
    } finally { unsubscribe(); release(); }
  });
}

for (const viewing of [false, true]) {
  test(`실제 접근 요청 API → 소유자·관리자 알림 → SSE·배지·요청 식별자 (패드 접속=${viewing})`, async () => {
    const releaseOwner = viewing ? markViewing(board.id, "owner") : () => {};
    const releaseAdmin = viewing ? markViewing(board.id, "admin") : () => {};
    const { GET: eventsGET } = await import("../app/api/notifications/events/route");
    const { POST } = await import("../app/api/boards/[boardId]/access-requests/route");
    sessionUserId = "owner";
    const streamController = new AbortController();
    const response = await eventsGET(new Request("http://localhost/api/notifications/events", { signal: streamController.signal }));
    assert.equal(response.status, 200);
    const reader = response.body!.getReader();
    const decoder = new TextDecoder();
    try {
      assert.match(decoder.decode((await reader.read()).value), /event: ready/);
      sessionUserId = "requester";
      const submitted = await POST(new Request("http://localhost/api/test", { method: "POST" }), { params: Promise.resolve({ boardId: board.id }) });
      assert.equal(submitted.status, 200, await submitted.clone().text());
      assert.equal((await submitted.json()).request.status, "PENDING");
      assert.equal(accessRequests[0].userId, "requester");
      assert.deepEqual(notifications.map((item) => item.userId).sort(), ["admin", "owner"], "접속 중인 소유자·관리자도 각각 한 번 수신");
      // 발행은 동기적입니다. 큐는 보존한 채 종료해 이벤트 유실 시에도 무한 대기하지 않습니다.
      streamController.abort();
      const chunk = await reader.read();
      assert.match(decoder.decode(chunk.value), /event: notification/);
      const payload = JSON.parse(decoder.decode(chunk.value).split("data: ")[1]);
      assert.equal(payload.notificationId, notifications.find((item) => item.userId === "owner")!.id);
      for (const userId of ["owner", "admin"]) {
        assert.equal((await getNotificationSummary(userId)).unreadCount, 1);
        const list = await getNotificationList(userId);
        assert.equal(list.notifications[0].type, "ACCESS_REQUEST_RECEIVED");
        assert.equal(list.notifications[0].accessRequestId, "access-request");
        assert.equal(list.notifications[0].board?.id, board.id);
      }
    } finally { streamController.abort(); await reader.cancel(); releaseOwner(); releaseAdmin(); }
  });
}

for (const type of ["POST_COMMENTED", "REACTION_ON_POST"] as NotificationType[]) {
  test(`${type}: 보드 접속 중 중복 알림 생략은 유지한다`, async () => {
    const release = markViewing(board.id, "recipient");
    try {
      await createNotification({ userId: "recipient", actorId: "requester", boardId: board.id, type });
      assert.equal(notifications.length, 0);
    } finally { release(); }
    await createNotification({ userId: "recipient", actorId: "requester", boardId: board.id, type });
    assert.equal(notifications.length, 1, "접속하지 않으면 일반 알림도 수신");
  });
}

test("자기 행동 알림 차단은 접근 요청에도 유지한다", async () => {
  await createNotification({ userId: "requester", actorId: "requester", boardId: board.id, type: "ACCESS_REQUEST_RECEIVED" });
  assert.equal(notifications.length, 0);
});
