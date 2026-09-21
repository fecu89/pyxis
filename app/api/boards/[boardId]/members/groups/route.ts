import { z } from "zod";
import { canManageBoardSettings, getEffectiveBoardAccess, requireActiveUser } from "@/lib/auth/authorization";
import { createAuditLogData } from "@/lib/auth/audit";
import { followBoardUsers, recordBoardActivity } from "@/lib/board/activity";
import { boardMemberDTO } from "@/lib/board/member-candidates";
import { apiError, assertSameOrigin } from "@/lib/http";
import { readJsonWithLimit } from "@/lib/http-json";
import { getPrisma } from "@/lib/prisma";
import { publishBoardEvent } from "@/lib/realtime/board-events";

// 학생 소유자는 자기 학급, 그 외(교사 등)는 자기 학교 전체만 대상으로 삼습니다 —
// lib/board/member-candidates.ts의 boardMemberCandidateScope와 같은 조직 경계입니다.
// 관리자 센터 "전체 퀴즈"와 달리 이 화면은 패드 설정 안이라 관리자 전용 네임스페이스를 쓰지
// 않습니다 — 패드 관리 권한이 있는 교사·학생 소유자가 자기 조직 범위의 학급·부서만 봅니다.
export async function GET(_request: Request, { params }: { params: Promise<{ boardId: string }> }) {
  try {
    const current = await requireActiveUser();
    const { boardId } = await params;
    const access = await getEffectiveBoardAccess(boardId, current);
    if (!access || !canManageBoardSettings(current, access)) {
      return Response.json({ error: "멤버 관리 권한이 없습니다." }, { status: 403 });
    }

    const prisma = getPrisma();
    if (current.role === "STUDENT") {
      if (!current.schoolGroup) return Response.json({ groups: [], note: "소속 학급 정보가 없어 그룹을 찾을 수 없습니다." });
      const memberCount = await prisma.user.count({ where: { schoolGroupId: current.schoolGroup.id, status: "ACTIVE" } });
      return Response.json({ groups: [{ id: current.schoolGroup.id, name: current.schoolGroup.name, type: current.schoolGroup.type, memberCount }] });
    }
    if (!current.school) return Response.json({ groups: [], note: "소속 학교 정보가 없어 그룹을 찾을 수 없습니다." });

    const groups = await prisma.schoolGroup.findMany({
      where: { schoolId: current.school.id },
      select: { id: true, name: true, type: true, _count: { select: { users: { where: { status: "ACTIVE" } } } } },
      orderBy: [{ type: "asc" }, { name: "asc" }],
    });
    return Response.json({ groups: groups.map((group) => ({ id: group.id, name: group.name, type: group.type, memberCount: group._count.users })) });
  } catch (error) {
    return apiError(error, "학급·부서 목록을 불러오지 못했습니다.");
  }
}

const bulkAddSchema = z.object({ schoolGroupId: z.string().min(1) });
const BULK_ADD_BODY_MAX_BYTES = 16 * 1024;

// 학급·부서 하나를 골라 소속 활성 인원 전체를 한 번에 멤버로 추가합니다. 역할은 항상 MEMBER로
// 고정합니다 — 특정 인원의 역할을 바꾸고 싶으면 멤버 목록의 역할 select로 따로 조정합니다.
// 이미 멤버인 사람은 건드리지 않고 조용히 건너뜁니다(개별 초대의 upsert와 달리, 그룹 추가에서
// 기존 역할을 되돌릴 이유가 없습니다).
export async function POST(request: Request, { params }: { params: Promise<{ boardId: string }> }) {
  try {
    assertSameOrigin(request);
    const current = await requireActiveUser();
    const { boardId } = await params;
    const access = await getEffectiveBoardAccess(boardId, current);
    if (!access || !canManageBoardSettings(current, access)) {
      return Response.json({ error: "멤버 관리 권한이 없습니다." }, { status: 403 });
    }
    const parsed = bulkAddSchema.safeParse(await readJsonWithLimit(request, BULK_ADD_BODY_MAX_BYTES));
    if (!parsed.success) return Response.json({ error: "추가할 학급·부서를 선택해 주세요." }, { status: 400 });

    const prisma = getPrisma();
    const group = await prisma.schoolGroup.findUnique({
      where: { id: parsed.data.schoolGroupId },
      select: { id: true, schoolId: true },
    });
    const inScope = group && (
      current.role === "STUDENT"
        ? group.id === current.schoolGroup?.id
        : group.schoolId === current.school?.id
    );
    if (!inScope) return Response.json({ error: "이 학급·부서의 구성원을 볼 권한이 없습니다." }, { status: 403 });

    const [existingMembers, groupUsers] = await Promise.all([
      prisma.boardMember.findMany({ where: { boardId }, select: { userId: true } }),
      // 200은 학급 정원(1~99번, studentNumber 유니크 제약)보다 넉넉한 방어적 상한이라
      // 실제로 걸릴 일은 없습니다.
      prisma.user.findMany({
        where: { schoolGroupId: parsed.data.schoolGroupId, status: "ACTIVE" },
        take: 200,
        select: { id: true, loginIdentifierEncrypted: true, nameEncrypted: true, imageEncrypted: true },
      }),
    ]);
    const excluded = new Set([...existingMembers.map((member) => member.userId), current.id, access.board.ownerId].filter((id): id is string => Boolean(id)));
    const targets = groupUsers.filter((user) => !excluded.has(user.id));
    const skippedCount = groupUsers.length - targets.length;

    const globalOverride = !["OWNER", "ADMIN"].includes(access.role ?? "");
    // 대상 수만큼 개별 create를 순차 await하면(최대 200명) 인터랙티브 트랜잭션의 5초 제한에
    // 걸릴 수 있습니다 — lib/forms/save.ts가 20문항×5보기(약 100건) 순차 update에서 실제로
    // 겪은 문제와 같은 종류입니다. createMany 한 번으로 묶고, skipDuplicates로 동시 요청과의
    // 경합(같은 사람을 다른 경로로 동시에 초대)도 에러 없이 넘어갑니다.
    const { count: addedCount } = await prisma.$transaction(async (transaction) => {
      const result = await transaction.boardMember.createMany({
        data: targets.map((target) => ({ boardId, userId: target.id, role: "MEMBER" as const })),
        skipDuplicates: true,
      });
      if (targets.length) {
        await transaction.boardAccessRequest.updateMany({
          where: { boardId, userId: { in: targets.map((target) => target.id) }, status: "PENDING" },
          data: { status: "APPROVED" },
        });
      }
      if (globalOverride && targets.length) {
        await transaction.adminAuditLog.createMany({
          data: targets.map((target) => createAuditLogData({
            actorId: current.id,
            targetUserId: target.id,
            action: "GLOBAL_BOARD_UPDATED",
            entityType: "BoardMember",
            entityId: boardId,
            after: { role: "MEMBER" },
            reason: "전역 권한으로 학급·부서 단위 패드 멤버 추가",
          })),
        });
      }
      return result;
    });

    if (addedCount) {
      // BoardActivity에는 합류한 target ID가 없으므로 사람마다 같은 행과 같은 SSE를 반복해도
      // 정보가 늘지 않습니다. 팔로우는 createMany 한 번, 활동과 이벤트는 일괄 작업당 한 번입니다.
      const [activityId] = await Promise.all([
        recordBoardActivity({ boardId, actorId: current.id, type: "MEMBER_JOINED", postId: null }),
        followBoardUsers(boardId, targets.map((target) => target.id)),
      ]);
      publishBoardEvent(boardId, {
        type: "board.updated",
        entityId: boardId,
        actorId: current.id,
        activityId,
        delivery: { public: false, recipientUserIds: [current.id, ...targets.map((target) => target.id)] },
      });
    }

    const added = targets.map((target) => boardMemberDTO({ role: "MEMBER", user: target }));
    return Response.json({ addedCount, skippedCount, added }, { status: 201 });
  } catch (error) {
    return apiError(error, "학급·부서 멤버를 추가하지 못했습니다.");
  }
}
