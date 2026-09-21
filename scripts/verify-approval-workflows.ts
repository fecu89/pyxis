import "../lib/load-env";

import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { hashUserPassword } from "../lib/auth/password";
import { PUBLIC_GUEST_REQUEST_HEADER } from "../lib/auth/public-guest";
import { createNotification } from "../lib/notifications/create";
import { getPrisma } from "../lib/prisma";
import { verifySocketUser } from "../lib/realtime/socket-server";
import {
  createLoginIdentifierLookup,
  encryptOptionalUserPii,
  encryptUserLoginIdentifier,
} from "../lib/security/pii-crypto-core";
import { createPadActivity } from "./fixtures";

const baseUrl = process.env.VERIFY_BASE_URL || "http://localhost:3001";
const origin = process.env.VERIFY_ORIGIN || baseUrl;
const tag = randomUUID().replaceAll("-", "").slice(0, 10);
const password = `Approve!${tag}7`;

class CookieJar {
  private readonly values = new Map<string, string>();

  capture(response: Response) {
    const setCookies = (response.headers as Headers & { getSetCookie?: () => string[] }).getSetCookie?.()
      ?? (response.headers.get("set-cookie") ? [response.headers.get("set-cookie")!] : []);
    for (const value of setCookies) {
      const first = value.split(";", 1)[0];
      const separator = first.indexOf("=");
      if (separator > 0) this.values.set(first.slice(0, separator), first.slice(separator + 1));
    }
  }

  header() {
    return [...this.values].map(([name, value]) => `${name}=${value}`).join("; ");
  }
}

async function createCredentialUser(loginId: string, role: "SUPER_ADMIN" | "STUDENT", approval: "APPROVED" | "PENDING", name: string) {
  const id = randomUUID();
  await getPrisma().user.create({
    data: {
      id,
      loginIdentifierLookup: createLoginIdentifierLookup(loginId),
      loginIdentifierEncrypted: encryptUserLoginIdentifier(id, loginId),
      nameEncrypted: encryptOptionalUserPii(id, "name", name),
      passwordHash: await hashUserPassword(password),
      role,
      registrationApprovalStatus: approval,
      onboardingCompletedAt: role === "SUPER_ADMIN" ? new Date() : null,
    },
  });
  return id;
}

async function login(loginId: string) {
  const jar = new CookieJar();
  const csrfResponse = await fetch(`${baseUrl}/api/auth/csrf`, { headers: { Cookie: jar.header() } });
  jar.capture(csrfResponse);
  const { csrfToken } = await csrfResponse.json() as { csrfToken: string };
  const response = await fetch(`${baseUrl}/api/auth/callback/credentials`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded", Cookie: jar.header(), Origin: origin },
    body: new URLSearchParams({ csrfToken, loginId, password, callbackUrl: `${baseUrl}/dashboard`, json: "true" }),
    redirect: "manual",
  });
  jar.capture(response);
  assert.equal(response.status, 200, `${loginId} 로그인에 실패했습니다.`);
  return jar;
}

async function main() {
  const prisma = getPrisma();
  const adminLogin = `approveadmin${tag}`.slice(0, 20);
  const applicantLogin = `approveuser${tag}`.slice(0, 20);
  const requesterLogin = `padrequest${tag}`.slice(0, 20);
  const adminId = await createCredentialUser(adminLogin, "SUPER_ADMIN", "APPROVED", "승인 검증 관리자");
  const applicantId = await createCredentialUser(applicantLogin, "STUDENT", "PENDING", "가입 승인 신청자");
  const requesterId = await createCredentialUser(requesterLogin, "STUDENT", "APPROVED", "패드 접근 신청자");
  let activityId: string | null = null;

  try {
    activityId = await createPadActivity(prisma, adminId, `공개 접근 검증 ${tag}`);
    const board = await prisma.board.create({
      data: {
        ownerId: adminId,
        activityId,
        title: `공개 접근 검증 ${tag}`,
        slug: `access-verify-${tag}`,
        discoveryScope: "PUBLIC",
        visitorPermission: "READER",
        loginRequired: false,
      },
      select: { id: true, slug: true, title: true },
    });

    assert.equal(await verifySocketUser(applicantId, 1), null, "가입 승인 전 계정이 인증 소켓에 접속할 수 있습니다.");
    const applicantJar = await login(applicantLogin);
    const pendingRedirect = await fetch(`${baseUrl}/dashboard`, { headers: { Cookie: applicantJar.header() }, redirect: "manual" });
    assert.match(pendingRedirect.headers.get("location") ?? "", /\/approval-pending/, "승인 전 계정이 대기 화면으로 이동하지 않습니다.");
    const pendingPage = await fetch(`${baseUrl}/approval-pending`, { headers: { Cookie: applicantJar.header() } });
    assert.equal(pendingPage.status, 200);
    assert.match(await pendingPage.text(), /가입 요청을 확인하고 있어요/, "계정 승인 대기 안내가 렌더링되지 않습니다.");

    const publicGuide = await fetch(`${baseUrl}/guide`, {
      headers: { Cookie: applicantJar.header() },
      redirect: "manual",
    });
    assert.equal(publicGuide.status, 200, "승인 대기 계정이 공개 가이드에서 차단됐습니다.");
    const publicBoard = await fetch(`${baseUrl}/b/${board.slug}`, {
      headers: { Cookie: applicantJar.header() },
      redirect: "manual",
    });
    assert.equal(publicBoard.status, 200, "승인 대기 계정이 로그인 불필요 패드에서 차단됐습니다.");
    assert.match(await publicBoard.text(), new RegExp(board.title), "공개 패드 본문이 렌더링되지 않았습니다.");
    const publicSnapshot = await fetch(`${baseUrl}/api/boards/${board.id}/realtime-snapshot`, {
      headers: { Cookie: applicantJar.header(), Referer: `${baseUrl}/b/${board.slug}` },
    });
    assert.equal(publicSnapshot.status, 200, "공개 패드에서 호출한 API가 승인 게이트에 막혔습니다.");

    // 공개 경로를 통과시키더라도 승인 전 계정의 기존 멤버십을 사용하면 안 됩니다. 같은 URL의
    // 보드를 비공개로 바꿨을 때는 게스트 판정으로 내용이 감춰져야 합니다.
    await prisma.boardMember.create({ data: { boardId: board.id, userId: applicantId, role: "MEMBER" } });
    await prisma.board.update({
      where: { id: board.id },
      data: { discoveryScope: "PRIVATE", visitorPermission: "NO_ACCESS" },
    });
    const privateBoard = await fetch(`${baseUrl}/b/${board.slug}`, {
      headers: { Cookie: applicantJar.header() },
      redirect: "manual",
    });
    assert.equal(privateBoard.status, 200);
    assert.doesNotMatch(await privateBoard.text(), new RegExp(board.title), "승인 전 계정이 공개 경로를 통해 비공개 멤버 권한을 사용했습니다.");

    const adminJar = await login(adminLogin);
    const queueResponse = await fetch(`${baseUrl}/api/admin/account-approvals?page=1&pageSize=20`, {
      // 외부에서 내부 게스트 헤더를 위조해도 프록시가 지워야 하며, 승인된 관리자의 세션은
      // 정상적으로 유지되어야 합니다.
      headers: { Cookie: adminJar.header(), [PUBLIC_GUEST_REQUEST_HEADER]: "1" },
    });
    assert.equal(queueResponse.status, 200);
    const queue = await queueResponse.json() as { requests: Array<{ id: string }> };
    assert.ok(queue.requests.some((request) => request.id === applicantId), "관리자 가입 승인 대기열에 신청자가 없습니다.");

    const approvalResponse = await fetch(`${baseUrl}/api/admin/account-approvals/${applicantId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json", Cookie: adminJar.header(), Origin: origin },
      body: JSON.stringify({ action: "APPROVE", reason: "HTTP 승인 흐름 검증" }),
    });
    assert.equal(approvalResponse.status, 200, await approvalResponse.clone().text());
    const approved = await prisma.user.findUniqueOrThrow({
      where: { id: applicantId },
      select: { registrationApprovalStatus: true, registrationReviewedById: true },
    });
    assert.equal(approved.registrationApprovalStatus, "APPROVED");
    assert.equal(approved.registrationReviewedById, adminId);
    assert.ok(await verifySocketUser(applicantId, 1), "가입 승인 뒤에도 인증 소켓 사용자 확인이 실패합니다.");

    const refreshedSession = await fetch(`${baseUrl}/api/auth/session`, { headers: { Cookie: applicantJar.header() } });
    applicantJar.capture(refreshedSession);
    const afterApproval = await fetch(`${baseUrl}/dashboard`, { headers: { Cookie: applicantJar.header() }, redirect: "manual" });
    assert.match(afterApproval.headers.get("location") ?? "", /\/onboarding/, "승인 뒤 프로필 온보딩으로 이동하지 않습니다.");

    const accessRequest = await prisma.boardAccessRequest.create({
      data: { boardId: board.id, userId: requesterId },
      select: { id: true },
    });
    await createNotification({
      userId: adminId,
      actorId: requesterId,
      type: "ACCESS_REQUEST_RECEIVED",
      boardId: board.id,
      accessRequestId: accessRequest.id,
    });

    const notificationResponse = await fetch(`${baseUrl}/api/notifications`, { headers: { Cookie: adminJar.header() } });
    assert.equal(notificationResponse.status, 200);
    const notifications = await notificationResponse.json() as {
      notifications: Array<{ type: string; accessRequestId: string | null; board: { id: string } | null }>;
    };
    assert.ok(notifications.notifications.some((item) =>
      item.type === "ACCESS_REQUEST_RECEIVED"
      && item.accessRequestId === accessRequest.id
      && item.board?.id === board.id), "알림 응답에 패드 접근 요청 ID가 연결되지 않았습니다.");

    const targetedResponse = await fetch(`${baseUrl}/api/boards/${board.id}/access-requests?requestId=${accessRequest.id}`, {
      headers: { Cookie: adminJar.header() },
    });
    const targeted = await targetedResponse.json() as { requests: Array<{ id: string }>; totalCount: number };
    assert.equal(targetedResponse.status, 200);
    assert.deepEqual(targeted.requests.map((request) => request.id), [accessRequest.id], "알림 모달용 단일 요청 조회가 다른 요청을 섞었습니다.");

    const padApproval = await fetch(`${baseUrl}/api/boards/${board.id}/access-requests`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json", Cookie: adminJar.header(), Origin: origin },
      body: JSON.stringify({ requestId: accessRequest.id, action: "APPROVE" }),
    });
    assert.equal(padApproval.status, 200, await padApproval.clone().text());
    assert.ok(await prisma.boardMember.findUnique({ where: { boardId_userId: { boardId: board.id, userId: requesterId } } }), "패드 접근 승인 뒤 멤버가 연결되지 않았습니다.");

    console.log("account_approval_http=ok pending_gate=ok public_guest_access=ok socket_gate=ok pad_notification_modal_contract=ok pad_access_approval=ok");
  } finally {
    if (activityId) await prisma.activity.delete({ where: { id: activityId } }).catch(() => undefined);
    await prisma.user.deleteMany({ where: { id: { in: [adminId, applicantId, requesterId] } } }).catch(() => undefined);
    await prisma.$disconnect();
  }
}

void main().catch((error) => {
  console.error(error);
  process.exit(1);
});
