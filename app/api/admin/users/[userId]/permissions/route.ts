import { z } from "zod";
import { SystemPermission } from "@/generated/prisma/enums";
import { requireRecentAuthentication, requireRole } from "@/lib/auth/authorization";
import { createAuditLogData } from "@/lib/auth/audit";
import { apiError, assertSameOrigin } from "@/lib/http";
import { getPrisma } from "@/lib/prisma";

// 스키마의 열거형을 손으로 다시 적으면 값이 늘었을 때 조용히 뒤처져, 관리 화면이 보내는 새 권한을
// 이 라우트가 400으로 거절하게 됩니다. 생성된 enum을 그대로 씁니다.
const permissionNames = Object.values(SystemPermission);

const permissionsSchema = z.object({
  permissions: z.array(z.enum(permissionNames)).max(permissionNames.length),
  reason: z.string().trim().min(3).max(500),
});

export async function PUT(request: Request, { params }: { params: Promise<{ userId: string }> }) {
  try {
    assertSameOrigin(request);
    const actor = await requireRole(["SUPER_ADMIN"]);
    await requireRecentAuthentication(actor);
    const { userId } = await params;
    const parsed = permissionsSchema.safeParse(await request.json());
    if (!parsed.success) return Response.json({ error: "권한 목록과 변경 사유를 확인해 주세요." }, { status: 400 });
    const desired = [...new Set(parsed.data.permissions)];
    const prisma = getPrisma();
    const target = await prisma.user.findUnique({
      where: { id: userId },
      select: { id: true, role: true, systemPermissions: { select: { permission: true } } },
    });
    if (!target) return Response.json({ error: "사용자를 찾을 수 없습니다." }, { status: 404 });
    if (target.role !== "ADMIN") return Response.json({ error: "시스템 권한은 보조관리자에게만 부여할 수 있습니다." }, { status: 409 });
    const current = target.systemPermissions.map(({ permission }) => permission);
    const granted = desired.filter((permission) => !current.includes(permission));
    const revoked = current.filter((permission) => !desired.includes(permission));
    if (!granted.length && !revoked.length) return Response.json({ permissions: current });

    await prisma.$transaction(async (tx) => {
      if (revoked.length) await tx.userSystemPermission.deleteMany({ where: { userId, permission: { in: revoked } } });
      if (granted.length) await tx.userSystemPermission.createMany({ data: granted.map((permission) => ({ userId, permission, grantedById: actor.id })) });
      await tx.user.update({ where: { id: userId }, data: { authVersion: { increment: 1 } } });
      const auditRows = [
        ...granted.map((permission) => createAuditLogData({ actorId: actor.id, targetUserId: userId, action: "ADMIN_PERMISSION_GRANTED" as const, entityType: "UserSystemPermission", entityId: `${userId}:${permission}`, after: { permission }, reason: parsed.data.reason })),
        ...revoked.map((permission) => createAuditLogData({ actorId: actor.id, targetUserId: userId, action: "ADMIN_PERMISSION_REVOKED" as const, entityType: "UserSystemPermission", entityId: `${userId}:${permission}`, before: { permission }, reason: parsed.data.reason })),
      ];
      if (auditRows.length) await tx.adminAuditLog.createMany({ data: auditRows });
    });
    return Response.json({ permissions: desired });
  } catch (error) {
    return apiError(error, "보조관리자 권한을 변경하지 못했습니다.");
  }
}
