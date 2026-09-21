import { z } from "zod";
import { credentialLoginIdValueSchema } from "@/lib/auth/credentials";
import {
  canAssignBoardRole,
  canManageBoardSettings,
  getEffectiveBoardAccess,
  hasSystemPermission,
  requireActiveUser,
} from "@/lib/auth/authorization";
import { createAuditLogData } from "@/lib/auth/audit";
import { followBoard, recordBoardActivity } from "@/lib/board/activity";
import { boardMemberDTO as memberDTO } from "@/lib/board/member-candidates";
import { createLoginIdentifierLookup } from "@/lib/security/pii-crypto";
import { apiError, assertSameOrigin } from "@/lib/http";
import { getPrisma } from "@/lib/prisma";
import { publishBoardEvent } from "@/lib/realtime/board-events";
import { APP_NAME } from "@/lib/brand";

const inviteSchema = z.object({
  loginId: credentialLoginIdValueSchema.optional(),
  email: z.string().trim().email().transform((value) => value.normalize("NFKC").toLocaleLowerCase("en-US")).optional(),
  userId: z.string().min(1).optional(),
  role: z.enum(["ADMIN", "EDITOR", "MEMBER", "VIEWER"]).default("MEMBER"),
}).refine((value) => Boolean(value.loginId || value.email || value.userId), "아이디·카카오 이메일 또는 사용자를 선택해 주세요.");

// 페이지 로드 시점의 board.members는 미리보기(최대 MEMBER_PREVIEW_LIMIT명)만 담고 있어서
// (lib/board/queries.ts), 실제 멤버 관리(역할 변경·제거) UI는 설정 패널이 열릴 때 이 API로
// 전체 목록을 따로 불러옵니다.
const MEMBERS_PAGE_SIZE = 100;

export async function GET(request: Request, { params }: { params: Promise<{ boardId: string }> }) {
  try {
    const current = await requireActiveUser();
    const { boardId } = await params;
    const access = await getEffectiveBoardAccess(boardId, current);
    if (!access || !canManageBoardSettings(current, access)) {
      return Response.json({ error: "멤버 목록을 볼 권한이 없습니다." }, { status: 403 });
    }
    const page = Math.max(1, Math.min(10_000, Number.parseInt(new URL(request.url).searchParams.get("page") ?? "1", 10) || 1));
    const where = { boardId, user: { status: { not: "DELETED" as const } } };
    const prisma = getPrisma();
    const [members, totalCount] = await Promise.all([
      prisma.boardMember.findMany({
      // 과거 soft-delete 로직이 남긴 관계가 있더라도 관리 화면과 멘션 후보에는 노출하지 않습니다.
      // 현재 삭제 경로는 같은 트랜잭션에서 BoardMember를 지우지만, 이 조건은 이전 데이터와 직접
      // DB 변경에 대한 읽기 방어선입니다.
      where,
      orderBy: { joinedAt: "asc" },
      skip: (page - 1) * MEMBERS_PAGE_SIZE,
      take: MEMBERS_PAGE_SIZE,
      select: {
        role: true,
        user: { select: { id: true, loginIdentifierEncrypted: true, nameEncrypted: true, imageEncrypted: true } },
      },
      }),
      prisma.boardMember.count({ where }),
    ]);
    return Response.json({ members: members.map(memberDTO), page, pageSize: MEMBERS_PAGE_SIZE, totalCount });
  } catch (error) {
    return apiError(error, "멤버 목록을 불러오지 못했습니다.");
  }
}

export async function POST(request: Request, { params }: { params: Promise<{ boardId: string }> }) {
  try {
    assertSameOrigin(request);
    const current = await requireActiveUser();
    const { boardId } = await params;
    const access = await getEffectiveBoardAccess(boardId, current);
    if (!access || !canManageBoardSettings(current, access)) {
      return Response.json({ error: "멤버 관리 권한이 없습니다." }, { status: 403 });
    }
    const parsed = inviteSchema.safeParse(await request.json());
    if (!parsed.success) return Response.json({ error: "아이디·카카오 이메일과 역할을 확인해 주세요." }, { status: 400 });
    const canAssignAdmin = access.role === "OWNER"
      || current.role === "SUPER_ADMIN"
      || hasSystemPermission(current, "MANAGE_BOARD_SETTINGS");
    if (parsed.data.role === "ADMIN" && !canAssignAdmin) {
      return Response.json({ error: "소유자 또는 전역 패드 관리자만 패드 관리자를 지정할 수 있습니다." }, { status: 403 });
    }

    const prisma = getPrisma();
    // userId는 같은 학교 후보 목록에서 고른 경우고 loginId/email은 직접 입력한 경우입니다.
    // 후보 목록의 로그인 식별자는 마스킹되므로 선택 결과는 userId로 바로 찾습니다.
    const directLoginIdentifier = parsed.data.loginId ?? parsed.data.email;
    const target = parsed.data.userId
      ? await prisma.user.findUnique({ where: { id: parsed.data.userId }, select: { id: true, role: true, status: true } })
      : await prisma.user.findUnique({ where: { loginIdentifierLookup: createLoginIdentifierLookup(directLoginIdentifier!) }, select: { id: true, role: true, status: true } });
    if (!target || target.status !== "ACTIVE") {
      return Response.json({ error: `활성 ${APP_NAME} 사용자를 찾을 수 없습니다.` }, { status: 404 });
    }
    if (!canAssignBoardRole(target.role, parsed.data.role)) {
      return Response.json({ error: "학생은 멤버 또는 읽기 전용 역할만 받을 수 있습니다." }, { status: 400 });
    }
    if (target.id === access.board.ownerId) return Response.json({ error: "패드 소유자는 이미 참여 중입니다." }, { status: 400 });

    const globalOverride = !["OWNER", "ADMIN"].includes(access.role ?? "");
    const member = await prisma.$transaction(async (transaction) => {
      const membership = await transaction.boardMember.upsert({
        where: { boardId_userId: { boardId, userId: target.id } },
        update: { role: parsed.data.role },
        create: { boardId, userId: target.id, role: parsed.data.role },
        select: {
          role: true,
          user: { select: { id: true, loginIdentifierEncrypted: true, nameEncrypted: true, imageEncrypted: true } },
        },
      });
      await transaction.boardAccessRequest.updateMany({
        where: { boardId, userId: target.id, status: "PENDING" },
        data: { status: "APPROVED" },
      });
      if (globalOverride) {
        await transaction.adminAuditLog.create({
          data: createAuditLogData({
            actorId: current.id,
            targetUserId: target.id,
            action: "GLOBAL_BOARD_UPDATED",
            entityType: "BoardMember",
            entityId: boardId,
            after: { role: parsed.data.role },
            reason: "전역 권한으로 패드 멤버 추가",
          }),
        });
      }
      return membership;
    });
    const activityId = await recordBoardActivity({ boardId, actorId: current.id, type: "MEMBER_JOINED", postId: null });
    publishBoardEvent(boardId, {
      type: "board.updated",
      entityId: boardId,
      actorId: current.id,
      activityId,
      delivery: { public: false, recipientUserIds: [current.id, target.id] },
    });
    await followBoard(boardId, target.id);
    return Response.json({ member: memberDTO(member) }, { status: 201 });
  } catch (error) {
    return apiError(error, "멤버를 초대하지 못했습니다.");
  }
}
