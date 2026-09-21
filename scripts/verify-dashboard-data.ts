import "../lib/load-env";
import assert from "node:assert/strict";
import { getDashboardHomeData } from "../lib/dashboard/queries";
import { getRecentBoardVisits, getRecentContentVisits } from "../lib/dashboard/visits";
import { getPrisma } from "../lib/prisma";
import { getPrivateUserDTO } from "../lib/users/repository";
import { createPadActivity } from "./fixtures";

const cleanupBoardIds: string[] = [];
const cleanupQuizIds: string[] = [];

async function main() {
  const prisma = getPrisma();
  const [owner, participant] = await Promise.all([
    prisma.user.findFirst({ where: { status: "ACTIVE", role: { in: ["TEACHER", "SUPER_ADMIN"] } }, select: { id: true } }),
    prisma.user.findFirst({ where: { status: "ACTIVE", role: "STUDENT" }, select: { id: true } }),
  ]);
  assert.ok(owner && participant, "대시보드 검증용 교사와 학생이 필요합니다.");
  const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const visitOrderBase = Date.now();
  const sharedBoard = await prisma.board.create({
    data: {
      slug: `verify-dashboard-shared-${suffix}`,
      title: "[검증용] 공유 대시보드",
      ownerId: owner.id,
      activityId: await createPadActivity(prisma, owner.id, "[검증용] 공유 대시보드"),
      members: { create: [{ userId: owner.id, role: "OWNER" }, { userId: participant.id, role: "VIEWER" }] },
      visits: { create: { userId: participant.id, lastVisitedAt: new Date(visitOrderBase - 2_000) } },
    },
    select: { id: true },
  });
  cleanupBoardIds.push(sharedBoard.id);
  const writableBoard = await prisma.board.create({
    data: {
      slug: `verify-dashboard-writable-${suffix}`,
      title: "[검증용] 글쓰기 참여 패드",
      ownerId: owner.id,
      activityId: await createPadActivity(prisma, owner.id, "[검증용] 글쓰기 참여 패드"),
      allowMemberPosting: true,
      members: { create: [{ userId: owner.id, role: "OWNER" }, { userId: participant.id, role: "MEMBER" }] },
    },
    select: { id: true },
  });
  cleanupBoardIds.push(writableBoard.id);
  const publicVisitBoard = await prisma.board.create({
    data: {
      slug: `verify-dashboard-public-visit-${suffix}`,
      title: "[검증용] 최근 방문 공개 패드",
      ownerId: owner.id,
      activityId: await createPadActivity(prisma, owner.id, "[검증용] 최근 방문 공개 패드"),
      discoveryScope: "PUBLIC",
      visitorPermission: "READER",
      loginRequired: false,
      members: { create: { userId: owner.id, role: "OWNER" } },
      visits: { create: { userId: participant.id, lastVisitedAt: new Date(visitOrderBase - 1_000) } },
    },
    select: { id: true },
  });
  cleanupBoardIds.push(publicVisitBoard.id);
  const recentQuiz = await prisma.quiz.create({
    data: {
      title: "[검증용] 최근 방문 퀴즈",
      ownerId: owner.id,
      shares: { create: { userId: participant.id, grantedById: owner.id, permission: "VIEWER" } },
      visits: { create: { userId: participant.id, lastVisitedAt: new Date(visitOrderBase + 1_000) } },
    },
    select: { id: true },
  });
  cleanupQuizIds.push(recentQuiz.id);
  const unvisitedQuiz = await prisma.quiz.create({
    data: {
      title: "[검증용] 방문하지 않은 최신 수정 퀴즈",
      ownerId: owner.id,
      shares: { create: { userId: participant.id, grantedById: owner.id, permission: "VIEWER" } },
    },
    select: { id: true },
  });
  cleanupQuizIds.push(unvisitedQuiz.id);
  const requestBoard = await prisma.board.create({
    data: {
      slug: `verify-dashboard-request-${suffix}`,
      title: "[검증용] 요청 대시보드",
      ownerId: owner.id,
      activityId: await createPadActivity(prisma, owner.id, "[검증용] 요청 대시보드"),
      members: { create: { userId: owner.id, role: "OWNER" } },
      accessRequests: { create: { userId: participant.id, status: "PENDING" } },
    },
    select: { id: true },
  });
  cleanupBoardIds.push(requestBoard.id);
  const participantDto = await getPrivateUserDTO(participant.id);
  assert.ok(participantDto);
  const [fixtureData, recentVisits, recentContent] = await Promise.all([
    getDashboardHomeData(participantDto),
    getRecentBoardVisits(participantDto, 8),
    getRecentContentVisits(participantDto, 8),
  ]);
  assert.equal(fixtureData.myBoards.find((board) => board.id === sharedBoard.id)?.relation, "SHARED", "초대된 보드는 공유받은 보드로 분류되어야 합니다.");
  assert.equal(fixtureData.myBoards.find((board) => board.id === sharedBoard.id)?.canWritePosts, false, "VIEWER 참여 패드는 보기 전용이어야 합니다.");
  assert.equal(fixtureData.myBoards.find((board) => board.id === writableBoard.id)?.canWritePosts, true, "글쓰기가 허용된 MEMBER 참여 패드는 글쓰기 가능이어야 합니다.");
  assert.ok(fixtureData.recentBoards.some((board) => board.id === sharedBoard.id), "최근 확인한 공유 보드는 최근 본 목록에 포함되어야 합니다.");
  assert.ok(fixtureData.recentBoards.some((board) => board.id === publicVisitBoard.id), "팔로우하지 않은 공개 패드 방문도 최근 목록에 포함되어야 합니다.");
  assert.ok(!fixtureData.myBoards.some((board) => board.id === publicVisitBoard.id), "방문만 한 공개 패드는 내 패드 목록에 섞이지 않아야 합니다.");
  const publicVisitIndex = fixtureData.recentBoards.findIndex((board) => board.id === publicVisitBoard.id);
  const sharedVisitIndex = fixtureData.recentBoards.findIndex((board) => board.id === sharedBoard.id);
  assert.ok(publicVisitIndex < sharedVisitIndex, "여러 최근 방문은 마지막 방문 시각의 최신순이어야 합니다.");
  assert.equal(recentVisits[0]?.id, publicVisitBoard.id, "메인 대시보드 최근 활동도 마지막 방문 시각의 최신순이어야 합니다.");
  assert.equal(recentVisits[0]?.title, "[검증용] 최근 방문 공개 패드", "메인 대시보드는 Activity 복제본이 아닌 현재 패드 제목을 표시해야 합니다.");
  assert.equal(recentContent[0]?.key, `QUIZ:${recentQuiz.id}`, "패드와 퀴즈를 합친 최근 목록도 실제 마지막 방문 시각의 최신순이어야 합니다.");
  assert.ok(!recentContent.some((item) => item.key === `QUIZ:${unvisitedQuiz.id}`), "최근에 수정됐어도 방문하지 않은 퀴즈는 최근 방문에 포함되면 안 됩니다.");
  assert.equal(fixtureData.accessRequestBoards.find((board) => board.id === requestBoard.id)?.requestStatus, "PENDING", "접근 요청 대기 상태가 대시보드에 포함되어야 합니다.");

  const users = await prisma.user.findMany({
    where: { status: "ACTIVE" },
    orderBy: { createdAt: "asc" },
    take: 12,
    select: { id: true },
  });
  assert.ok(users.length, "대시보드 검증용 활성 사용자가 필요합니다.");
  let boardChecks = 0;
  let recentChecks = 0;
  let requestChecks = 0;

  for (const row of users) {
    const user = await getPrivateUserDTO(row.id);
    assert.ok(user, "활성 사용자의 비공개 DTO를 조회할 수 있어야 합니다.");
    const data = await getDashboardHomeData(user);
    const boardIds = data.myBoards.map((board) => board.id);
    const [owned, memberships, visits, requests] = await Promise.all([
      boardIds.length ? prisma.board.findMany({ where: { id: { in: boardIds }, ownerId: user.id }, select: { id: true } }) : [],
      boardIds.length ? prisma.boardMember.findMany({ where: { boardId: { in: boardIds }, userId: user.id }, select: { boardId: true, role: true } }) : [],
      prisma.boardVisit.findMany({ where: { userId: user.id }, select: { boardId: true, lastVisitedAt: true } }),
      prisma.boardAccessRequest.findMany({ where: { userId: user.id, status: { in: ["PENDING", "REJECTED"] }, board: { deletedAt: null } }, select: { boardId: true, status: true } }),
    ]);
    const ownedIds = new Set(owned.map((board) => board.id));
    const membershipByBoard = new Map(memberships.map((membership) => [membership.boardId, membership.role]));
    for (const board of data.myBoards) {
      const role = membershipByBoard.get(board.id) ?? null;
      const expected = ownedIds.has(board.id) || role === "OWNER" ? "OWNED" : role ? "SHARED" : "MANAGED";
      assert.equal(board.relation, expected, "대시보드 보드 관계가 DB 소유권·멤버십과 일치해야 합니다.");
      assert.equal(board.memberRole, role, "대시보드 역할이 DB 멤버십과 일치해야 합니다.");
      boardChecks += 1;
    }
    const visitByBoard = new Map(visits.map((visit) => [visit.boardId, visit.lastVisitedAt.toISOString()]));
    assert.ok(data.recentBoards.length <= 6, "최근 본 보드는 최대 6개여야 합니다.");
    for (let index = 0; index < data.recentBoards.length; index += 1) {
      const board = data.recentBoards[index];
      assert.equal(board.lastViewedAt, visitByBoard.get(board.id), "최근 본 시각은 BoardVisit과 일치해야 합니다.");
      if (index > 0) assert.ok(Date.parse(data.recentBoards[index - 1].lastViewedAt!) >= Date.parse(board.lastViewedAt!), "최근 본 보드는 내림차순이어야 합니다.");
      recentChecks += 1;
    }
    const requestByBoard = new Map(requests.map((request) => [request.boardId, request.status]));
    for (const request of data.accessRequestBoards) {
      assert.equal(request.requestStatus, requestByBoard.get(request.id), "접근 요청 상태는 현재 사용자의 DB 요청과 일치해야 합니다.");
      requestChecks += 1;
    }
  }

  console.log(`dashboard_data_checks=passed users=${users.length} boards=${boardChecks} recent=${recentChecks} requests=${requestChecks}`);
}

main()
  .catch((error) => {
    console.error(error instanceof Error ? error.message : "대시보드 데이터 검증에 실패했습니다.");
    process.exitCode = 1;
  })
  .finally(async () => {
    const prisma = getPrisma();
    if (cleanupQuizIds.length) await prisma.quiz.deleteMany({ where: { id: { in: cleanupQuizIds } } });
    if (cleanupBoardIds.length) await prisma.activity.deleteMany({ where: { board: { id: { in: cleanupBoardIds } } } });
    await prisma.$disconnect();
  });
