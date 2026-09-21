import { z } from "zod";
import { createAuditLogData } from "@/lib/auth/audit";
import { requireActiveUser } from "@/lib/auth/authorization";
import { apiError, assertSameOrigin } from "@/lib/http";
import { createNotification } from "@/lib/notifications/create";
import { getPrisma } from "@/lib/prisma";
import { findSchoolNicknameConflict } from "@/lib/users/nickname";
import { assertCanReviewTeacherApproval } from "@/lib/users/admin-policy";

const reviewSchema = z.object({
  action: z.enum(["APPROVE", "REJECT"]),
  reason: z.string().trim().min(3, "처리 사유를 3자 이상 입력해 주세요.").max(500, "처리 사유는 500자 이하로 입력해 주세요."),
});

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ requestId: string }> },
) {
  try {
    assertSameOrigin(request);
    const actor = await requireActiveUser();
    const parsed = reviewSchema.safeParse(await request.json());
    if (!parsed.success) {
      return Response.json(
        { error: parsed.error.issues[0]?.message || "처리 내용을 확인해 주세요." },
        { status: 400 },
      );
    }
    const { requestId } = await params;
    const prisma = getPrisma();
    const application = await prisma.teacherApprovalRequest.findUnique({
      where: { id: requestId },
      select: {
        id: true,
        status: true,
        schoolId: true,
        schoolGroupId: true,
        userId: true,
        user: { select: { status: true, role: true } },
        school: { select: { name: true } },
        schoolGroup: { select: { name: true, type: true, schoolId: true } },
      },
    });
    if (!application) return Response.json({ error: "교사 가입 요청을 찾을 수 없습니다." }, { status: 404 });
    assertCanReviewTeacherApproval(actor, application.schoolId);
    if (application.status !== "PENDING") {
      return Response.json({ error: "이미 처리된 교사 가입 요청입니다." }, { status: 409 });
    }
    if (application.user.status !== "ACTIVE") {
      return Response.json({ error: "활성 상태인 사용자만 승인할 수 있습니다." }, { status: 409 });
    }
    if (application.user.role !== "STUDENT") {
      return Response.json({ error: "학생 상태의 가입 신청만 교사로 승인할 수 있습니다." }, { status: 409 });
    }
    if (application.schoolGroup.type !== "DEPARTMENT" || application.schoolGroup.schoolId !== application.schoolId) {
      return Response.json({ error: "교사 부서 정보가 올바르지 않습니다." }, { status: 409 });
    }

    const approved = parsed.data.action === "APPROVE";
    const reviewedAt = new Date();
    await prisma.$transaction(async (tx) => {
      const changed = await tx.teacherApprovalRequest.updateMany({
        where: { id: application.id, status: "PENDING" },
        data: {
          status: approved ? "APPROVED" : "REJECTED",
          reviewReason: parsed.data.reason,
          reviewedById: actor.id,
          reviewedAt,
        },
      });
      if (changed.count !== 1) throw new Error("다른 관리자가 먼저 이 요청을 처리했습니다.");

      if (approved) {
        // 승인 순간 schoolId가 처음 채워집니다. 닉네임 유일성이 학교 단위라, 대기 중에 같은
        // 이름을 가진 사람이 그 학교에 생겼으면 여기서 고유 제약 위반이 나므로 먼저 확인합니다.
        const conflict = await findSchoolNicknameConflict(tx, {
          schoolId: application.schoolId,
          userIds: [application.userId],
        });
        if (conflict) {
          throw new Error("이 학교에 같은 닉네임을 쓰는 사용자가 이미 있습니다. 신청자에게 닉네임 변경을 요청해 주세요.");
        }
        await tx.user.update({
          where: { id: application.userId },
          data: {
            role: "TEACHER",
            schoolId: application.schoolId,
            schoolGroupId: application.schoolGroupId,
            onboardingCompletedAt: reviewedAt,
          },
        });
      }

      await tx.adminAuditLog.create({
        data: createAuditLogData({
          actorId: actor.id,
          targetUserId: application.userId,
          action: approved ? "TEACHER_APPROVAL_APPROVED" : "TEACHER_APPROVAL_REJECTED",
          entityType: "TeacherApprovalRequest",
          entityId: application.id,
          before: { status: "PENDING", role: application.user.role },
          after: approved
            ? {
                status: "APPROVED",
                role: "TEACHER",
                schoolId: application.schoolId,
                schoolGroupId: application.schoolGroupId,
              }
            : { status: "REJECTED", role: application.user.role },
          reason: parsed.data.reason,
        }),
      });
    });

    await createNotification({
      userId: application.userId,
      actorId: actor.id,
      type: approved ? "TEACHER_APPROVAL_APPROVED" : "TEACHER_APPROVAL_REJECTED",
    }).catch((error) => console.error("교사 승인 결과 알림 생성 실패", error));

    return Response.json({
      ok: true,
      action: parsed.data.action,
      userId: application.userId,
      school: application.school,
      schoolGroup: application.schoolGroup,
      reviewedAt: reviewedAt.toISOString(),
    });
  } catch (error) {
    return apiError(error, "교사 가입 요청을 처리하지 못했습니다.");
  }
}
