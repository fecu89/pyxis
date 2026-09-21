import { z } from "zod";
import {
  canAssignBoardRole,
  canManageBoardSettings,
  getEffectiveBoardAccess,
  hasSystemPermission,
  requireActiveUser,
} from "@/lib/auth/authorization";
import { createAuditLogData } from "@/lib/auth/audit";
import { maskLoginIdentifier } from "@/lib/security/pii-crypto";
import { decryptUserLoginIdentifier, toPublicAuthorDTO } from "@/lib/users/repository";
import { apiError, assertSameOrigin } from "@/lib/http";
import { getPrisma } from "@/lib/prisma";
import { publishBoardEvent } from "@/lib/realtime/board-events";

const roleSchema = z.object({ role: z.enum(["ADMIN", "EDITOR", "MEMBER", "VIEWER"]) });

function memberDTO(member: {
  role: "OWNER" | "ADMIN" | "EDITOR" | "MEMBER" | "VIEWER";
  user: { id: string; loginIdentifierEncrypted: string; nameEncrypted: string | null; imageEncrypted: string | null };
}) {
  return {
    role: member.role,
    user: { ...toPublicAuthorDTO(member.user), loginIdentifier: maskLoginIdentifier(decryptUserLoginIdentifier(member.user)) },
  };
}

export async function PATCH(request: Request, { params }: { params: Promise<{ boardId: string; userId: string }> }) {
  try {
    assertSameOrigin(request);
    const current = await requireActiveUser();
    const { boardId, userId } = await params;
    const access = await getEffectiveBoardAccess(boardId, current);
    if (!access || !canManageBoardSettings(current, access)) return Response.json({ error: "멤버 관리 권한이 없습니다." }, { status: 403 });
    const parsed = roleSchema.safeParse(await request.json());
    if (!parsed.success) return Response.json({ error: "역할을 확인해 주세요." }, { status: 400 });
    if (userId === access.board.ownerId) return Response.json({ error: "소유자 역할은 변경할 수 없습니다." }, { status: 400 });
    const canAssignAdmin = access.role === "OWNER" || current.role === "SUPER_ADMIN" || hasSystemPermission(current, "MANAGE_BOARD_SETTINGS");
    if (parsed.data.role === "ADMIN" && !canAssignAdmin) return Response.json({ error: "패드 관리자 지정 권한이 없습니다." }, { status: 403 });

    const prisma = getPrisma();
    const target = await prisma.user.findUnique({ where: { id: userId }, select: { role: true, status: true } });
    if (!target || target.status !== "ACTIVE") return Response.json({ error: "활성 사용자를 찾을 수 없습니다." }, { status: 404 });
    if (!canAssignBoardRole(target.role, parsed.data.role)) return Response.json({ error: "학생은 멤버 또는 읽기 전용 역할만 받을 수 있습니다." }, { status: 400 });
    const existing = await prisma.boardMember.findUnique({ where: { boardId_userId: { boardId, userId } }, select: { role: true } });
    if (!existing) return Response.json({ error: "멤버를 찾을 수 없습니다." }, { status: 404 });

    const globalOverride = !["OWNER", "ADMIN"].includes(access.role ?? "");
    const member = await prisma.$transaction(async (transaction) => {
      const updated = await transaction.boardMember.update({
        where: { boardId_userId: { boardId, userId } },
        data: { role: parsed.data.role },
        select: { role: true, user: { select: { id: true, loginIdentifierEncrypted: true, nameEncrypted: true, imageEncrypted: true } } },
      });
      if (globalOverride) {
        await transaction.adminAuditLog.create({ data: createAuditLogData({ actorId: current.id, targetUserId: userId, action: "GLOBAL_BOARD_UPDATED", entityType: "BoardMember", entityId: boardId, before: { role: existing.role }, after: { role: parsed.data.role }, reason: "전역 권한으로 패드 역할 변경" }) });
      }
      return updated;
    });
    publishBoardEvent(boardId, {
      type: "board.updated",
      entityId: boardId,
      actorId: current.id,
      delivery: { public: false, recipientUserIds: [current.id, userId] },
    });
    return Response.json({ member: memberDTO(member) });
  } catch (error) {
    return apiError(error, "역할을 변경하지 못했습니다.");
  }
}

export async function DELETE(request: Request, { params }: { params: Promise<{ boardId: string; userId: string }> }) {
  try {
    assertSameOrigin(request);
    const current = await requireActiveUser();
    const { boardId, userId } = await params;
    const access = await getEffectiveBoardAccess(boardId, current);
    if (!access || !canManageBoardSettings(current, access)) return Response.json({ error: "멤버 관리 권한이 없습니다." }, { status: 403 });
    if (userId === access.board.ownerId) return Response.json({ error: "패드 소유자는 제거할 수 없습니다." }, { status: 400 });
    const prisma = getPrisma();
    const globalOverride = !["OWNER", "ADMIN"].includes(access.role ?? "");
    await prisma.$transaction(async (transaction) => {
      await transaction.boardMember.delete({ where: { boardId_userId: { boardId, userId } } });
      await transaction.boardAccessRequest.deleteMany({ where: { boardId, userId } });
      if (globalOverride) {
        await transaction.adminAuditLog.create({ data: createAuditLogData({ actorId: current.id, targetUserId: userId, action: "GLOBAL_BOARD_UPDATED", entityType: "BoardMember", entityId: boardId, reason: "전역 권한으로 패드 멤버 제거" }) });
      }
    });
    publishBoardEvent(boardId, {
      type: "board.updated",
      entityId: boardId,
      actorId: current.id,
      delivery: { public: false, recipientUserIds: [current.id, userId] },
    });
    return Response.json({ ok: true });
  } catch (error) {
    return apiError(error, "멤버를 제거하지 못했습니다.");
  }
}
