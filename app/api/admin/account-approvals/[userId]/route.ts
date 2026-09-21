import { z } from "zod";
import { createAuditLogData } from "@/lib/auth/audit";
import { requireRole } from "@/lib/auth/authorization";
import { apiError, assertSameOrigin } from "@/lib/http";
import { readJsonWithLimit } from "@/lib/http-json";
import { createNotification } from "@/lib/notifications/create";
import { getPrisma } from "@/lib/prisma";

const BODY_MAX_BYTES = 16 * 1024;
const reviewSchema = z.object({
  action: z.enum(["APPROVE", "REJECT"]),
  reason: z.string().trim().min(3, "처리 사유를 3자 이상 입력해 주세요.").max(500),
});

export async function PATCH(request: Request, { params }: { params: Promise<{ userId: string }> }) {
  try {
    assertSameOrigin(request);
    const actor = await requireRole(["SUPER_ADMIN"]);
    const parsed = reviewSchema.safeParse(await readJsonWithLimit(request, BODY_MAX_BYTES));
    if (!parsed.success) {
      return Response.json({ error: parsed.error.issues[0]?.message || "처리 내용을 확인해 주세요." }, { status: 400 });
    }
    const { userId } = await params;
    const approved = parsed.data.action === "APPROVE";
    const reviewedAt = new Date();
    const prisma = getPrisma();
    const applicant = await prisma.user.findUnique({
      where: { id: userId },
      select: { status: true, registrationApprovalStatus: true },
    });
    if (!applicant) return Response.json({ error: "가입 요청을 찾을 수 없습니다." }, { status: 404 });
    if (applicant.status !== "ACTIVE" || applicant.registrationApprovalStatus !== "PENDING") {
      return Response.json({ error: "이미 처리됐거나 활성 상태가 아닌 가입 요청입니다." }, { status: 409 });
    }

    await prisma.$transaction(async (tx) => {
      const changed = await tx.user.updateMany({
        where: { id: userId, status: "ACTIVE", registrationApprovalStatus: "PENDING" },
        data: {
          registrationApprovalStatus: approved ? "APPROVED" : "REJECTED",
          registrationReviewReason: parsed.data.reason,
          registrationReviewedAt: reviewedAt,
          registrationReviewedById: actor.id,
        },
      });
      if (changed.count !== 1) throw new Error("다른 관리자가 먼저 이 요청을 처리했습니다.");
      await tx.adminAuditLog.create({
        data: createAuditLogData({
          actorId: actor.id,
          targetUserId: userId,
          action: approved ? "ACCOUNT_APPROVAL_APPROVED" : "ACCOUNT_APPROVAL_REJECTED",
          entityType: "UserRegistration",
          entityId: userId,
          before: { status: "PENDING" },
          after: { status: approved ? "APPROVED" : "REJECTED" },
          reason: parsed.data.reason,
        }),
      });
    });

    await createNotification({
      userId,
      actorId: actor.id,
      type: approved ? "ACCOUNT_APPROVAL_APPROVED" : "ACCOUNT_APPROVAL_REJECTED",
    }).catch((error) => console.error("가입 승인 결과 알림 생성 실패", error));
    return Response.json({ ok: true, action: parsed.data.action, reviewedAt: reviewedAt.toISOString() });
  } catch (error) {
    return apiError(error, "가입 요청을 처리하지 못했습니다.");
  }
}
