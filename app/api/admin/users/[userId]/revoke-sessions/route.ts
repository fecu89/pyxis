import { z } from "zod";
import { requireActiveUser, requireRecentAuthentication } from "@/lib/auth/authorization";
import { createAuditLogData } from "@/lib/auth/audit";
import { apiError, assertSameOrigin } from "@/lib/http";
import { getPrisma } from "@/lib/prisma";
import { assertCanRevokeTargetSessions } from "@/lib/users/admin-policy";

const reasonSchema = z.object({ reason: z.string().trim().min(3).max(500) });

export async function POST(request: Request, { params }: { params: Promise<{ userId: string }> }) {
  try {
    assertSameOrigin(request);
    const actor = await requireActiveUser();
    const { userId } = await params;
    const parsed = reasonSchema.safeParse(await request.json());
    if (!parsed.success) return Response.json({ error: "세션 해제 사유를 입력해 주세요." }, { status: 400 });
    const prisma = getPrisma();
    const target = await prisma.user.findUnique({ where: { id: userId }, select: { id: true, role: true, authVersion: true } });
    if (!target) return Response.json({ error: "사용자를 찾을 수 없습니다." }, { status: 404 });
    assertCanRevokeTargetSessions(actor, target.role);
    await requireRecentAuthentication(actor);
    const nextVersion = target.authVersion + 1;
    await prisma.$transaction([
      prisma.user.update({ where: { id: userId }, data: { authVersion: nextVersion } }),
      prisma.adminAuditLog.create({ data: createAuditLogData({ actorId: actor.id, targetUserId: userId, action: "USER_SESSIONS_REVOKED", entityType: "User", entityId: userId, before: { authVersion: target.authVersion }, after: { authVersion: nextVersion }, reason: parsed.data.reason }) }),
    ]);
    return Response.json({ ok: true });
  } catch (error) {
    return apiError(error, "사용자 세션을 해제하지 못했습니다.");
  }
}
