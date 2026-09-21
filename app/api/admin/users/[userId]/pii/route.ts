import { z } from "zod";
import { requireRecentAuthentication, requireSystemPermission } from "@/lib/auth/authorization";
import { createAuditLogData } from "@/lib/auth/audit";
import { apiError, assertSameOrigin } from "@/lib/http";
import { getPrisma } from "@/lib/prisma";
import { decryptOptionalUserPii, decryptUserLoginIdentifier } from "@/lib/security/pii-crypto";

const reasonSchema = z.object({ reason: z.string().trim().min(3).max(500) });

export async function POST(request: Request, { params }: { params: Promise<{ userId: string }> }) {
  try {
    assertSameOrigin(request);
    const actor = await requireSystemPermission("VIEW_USER_PII");
    await requireRecentAuthentication(actor);
    const { userId } = await params;
    const parsed = reasonSchema.safeParse(await request.json());
    if (!parsed.success) return Response.json({ error: "개인정보 조회 사유를 입력해 주세요." }, { status: 400 });
    const prisma = getPrisma();
    const target = await prisma.$transaction(async (tx) => {
      const user = await tx.user.findUnique({
        where: { id: userId },
        select: { id: true, loginIdentifierEncrypted: true, passwordHash: true, nameEncrypted: true, imageEncrypted: true },
      });
      if (!user) return null;
      await tx.adminAuditLog.create({ data: createAuditLogData({ actorId: actor.id, targetUserId: userId, action: "USER_PII_VIEWED", entityType: "User", entityId: userId, after: { fields: [user.passwordHash ? "loginId" : "email", "name", "image"] }, reason: parsed.data.reason }) });
      return user;
    });
    if (!target) return Response.json({ error: "사용자를 찾을 수 없습니다." }, { status: 404 });
    const loginIdentifier = decryptUserLoginIdentifier(target.id, target.loginIdentifierEncrypted);
    const loginType = target.passwordHash ? "LOGIN_ID" : "KAKAO_EMAIL";
    return Response.json({
      pii: {
        loginIdentifier,
        loginType,
        name: decryptOptionalUserPii(target.id, "name", target.nameEncrypted),
        image: decryptOptionalUserPii(target.id, "image", target.imageEncrypted),
      },
    }, { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) {
    return apiError(error, "개인정보를 조회하지 못했습니다.");
  }
}
