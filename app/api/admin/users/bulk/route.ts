import { randomUUID } from "node:crypto";
import { unlink } from "node:fs/promises";
import { z } from "zod";
import { AuthorizationError, requireActiveUser, requireRecentAuthentication } from "@/lib/auth/authorization";
import { createAuditLogData } from "@/lib/auth/audit";
import { boardOwnershipLimitFor, roleLabelFor } from "@/lib/board/ownership-limit";
import { succeedOwnedBoards, summarizeSuccessions } from "@/lib/board/succession";
import { getAvatarPath } from "@/lib/files/paths";
import { apiError, assertSameOrigin } from "@/lib/http";
import { getPrisma } from "@/lib/prisma";
import { encryptUserLoginIdentifier, encryptUserPii } from "@/lib/security/pii-crypto";
import { assertCanChangeUserRole, assertCanChangeUserStatus, assertCanManageSchoolPlacement, assertCanManageUserOrganization } from "@/lib/users/admin-policy";

const bulkUpdateSchema = z.object({
  userIds: z.array(z.string().min(1)).min(1).max(100),
  role: z.enum(["SUPER_ADMIN", "ADMIN", "TEACHER", "STUDENT"]).optional(),
  status: z.enum(["ACTIVE", "SUSPENDED"]).optional(),
  schoolId: z.string().min(1).nullable().optional(),
  schoolGroupId: z.string().min(1).nullable().optional(),
  reason: z.string().trim().min(3).max(500),
}).refine(
  (value) => value.role !== undefined || value.status !== undefined || value.schoolId !== undefined || value.schoolGroupId !== undefined,
  "변경할 값을 입력해 주세요.",
);

const bulkDeleteSchema = z.object({
  userIds: z.array(z.string().min(1)).min(1).max(100),
  reason: z.string().trim().min(3).max(500),
});

// 단일 사용자 수정 라우트(app/api/admin/users/[userId]/route.ts)와 같은 필드(역할·상태·학교·
// 반/부서)만 다룹니다. 세션 해제·PII 조회·계정 삭제·보조관리자 권한은 대상마다 의미가 달라
// 일괄 처리에서 제외하고 행 단위 편집에서만 할 수 있게 남겨둡니다.
export async function PATCH(request: Request) {
  try {
    assertSameOrigin(request);
    const actor = await requireActiveUser();
    const isRepresentativeActor = actor.role === "TEACHER" && actor.isSchoolRepresentative;
    if (
      actor.role !== "SUPER_ADMIN"
      && !isRepresentativeActor
      && !actor.systemPermissions.some((permission) => permission === "CHANGE_NON_ADMIN_ROLES" || permission === "SUSPEND_USERS")
    ) {
      throw new AuthorizationError("사용자를 일괄 수정할 권한이 없습니다.");
    }
    const parsed = bulkUpdateSchema.safeParse(await request.json());
    if (!parsed.success) return Response.json({ error: "변경 값과 사유를 확인해 주세요." }, { status: 400 });
    // 대표교사는 자기 학교 배치(schoolId/schoolGroupId)만 일괄 변경할 수 있습니다 — 역할·상태는 못 씀.
    if (isRepresentativeActor && (parsed.data.role !== undefined || parsed.data.status !== undefined)) {
      return Response.json({ error: "대표교사는 역할·상태를 일괄 변경할 수 없습니다." }, { status: 403 });
    }
    const { reason } = parsed.data;
    const requestedIds = [...new Set(parsed.data.userIds)];
    const uniqueIds = requestedIds.filter((id) => id !== actor.id);

    const prisma = getPrisma();
    const targets = await prisma.user.findMany({
      where: { id: { in: uniqueIds }, status: { not: "DELETED" } },
      select: { id: true, role: true, status: true, schoolId: true, schoolGroupId: true, studentNumber: true, isSchoolRepresentative: true, _count: { select: { ownedBoards: true } } },
    });
    const targetById = new Map(targets.map((target) => [target.id, target]));

    const touchesTrustedRole = targets.some((target) => {
      const nextRole = parsed.data.role ?? target.role;
      return [target.role, nextRole].some((role) => role === "SUPER_ADMIN" || role === "ADMIN");
    });
    if (touchesTrustedRole) await requireRecentAuthentication(actor);

    const updated: string[] = [];
    const skipped: { userId: string; reason: string }[] = requestedIds.includes(actor.id)
      ? [{ userId: actor.id, reason: "현재 로그인한 계정은 일괄 수정에서 제외됩니다." }]
      : [];

    await prisma.$transaction(async (tx) => {
      for (const userId of uniqueIds) {
        const target = targetById.get(userId);
        if (!target) { skipped.push({ userId, reason: "사용자를 찾을 수 없습니다." }); continue; }

        const nextRole = parsed.data.role ?? target.role;
        const nextStatus = parsed.data.status ?? target.status;
        const organizationRequested = parsed.data.schoolId !== undefined || parsed.data.schoolGroupId !== undefined;
        const nextSchoolId = parsed.data.schoolId !== undefined ? parsed.data.schoolId : target.schoolId;
        let nextSchoolGroupId = parsed.data.schoolGroupId !== undefined ? parsed.data.schoolGroupId : target.schoolGroupId;
        if (nextRole === "SUPER_ADMIN" || nextRole === "ADMIN") nextSchoolGroupId = null;

        if (isRepresentativeActor && parsed.data.schoolId !== undefined && parsed.data.schoolId !== actor.school?.id) {
          skipped.push({ userId, reason: "대표교사는 자기 학교 밖으로 배치를 바꿀 수 없습니다." });
          continue;
        }
        try {
          if (parsed.data.role && parsed.data.role !== target.role) assertCanChangeUserRole(actor, target.role, parsed.data.role);
          if (parsed.data.status && parsed.data.status !== target.status) assertCanChangeUserStatus(actor, target.role);
          if (organizationRequested || nextRole !== target.role) {
            if (isRepresentativeActor) assertCanManageSchoolPlacement(actor, target);
            else assertCanManageUserOrganization(actor, target.role);
          }
        } catch (permissionError) {
          skipped.push({ userId, reason: permissionError instanceof Error ? permissionError.message : "권한이 없습니다." });
          continue;
        }

        const nextOwnershipLimit = await boardOwnershipLimitFor(nextRole);
        if (nextOwnershipLimit !== null && target._count.ownedBoards > nextOwnershipLimit) {
          skipped.push({ userId, reason: `패드를 ${nextOwnershipLimit}개 초과 소유해 ${roleLabelFor(nextRole)}로 변경할 수 없습니다.` });
          continue;
        }

        if (organizationRequested || nextRole !== target.role) {
          if ((nextRole === "STUDENT" || nextRole === "TEACHER") && (!nextSchoolId || !nextSchoolGroupId)) {
            skipped.push({ userId, reason: nextRole === "STUDENT" ? "학생의 학교와 반을 선택해야 합니다." : "교사의 학교와 부서를 선택해야 합니다." });
            continue;
          }
          if (nextSchoolGroupId) {
            const expectedType = nextRole === "STUDENT" ? "CLASS" : nextRole === "TEACHER" ? "DEPARTMENT" : null;
            const matchingGroup = expectedType
              ? await tx.schoolGroup.findFirst({ where: { id: nextSchoolGroupId, schoolId: nextSchoolId ?? "", type: expectedType }, select: { id: true } })
              : null;
            if (!matchingGroup) { skipped.push({ userId, reason: "역할에 맞는 학교 소속이 아닙니다." }); continue; }
          }
        }
        if (nextRole === "STUDENT" && nextSchoolGroupId && target.studentNumber !== null && nextSchoolGroupId !== target.schoolGroupId) {
          const duplicateNumber = await tx.user.findFirst({
            where: {
              id: { not: userId },
              status: { not: "DELETED" },
              schoolGroupId: nextSchoolGroupId,
              studentNumber: target.studentNumber,
            },
            select: { id: true },
          });
          if (duplicateNumber) {
            skipped.push({ userId, reason: `선택한 반에는 이미 ${target.studentNumber}번 학생이 있습니다.` });
            continue;
          }
        }

        const organizationChanged = nextSchoolId !== target.schoolId || nextSchoolGroupId !== target.schoolGroupId;
        const nextIsSchoolRepresentative = nextRole === "TEACHER"
          && nextStatus === "ACTIVE"
          && nextSchoolId === target.schoolId
          && target.isSchoolRepresentative;
        const representativeChanged = nextIsSchoolRepresentative !== target.isSchoolRepresentative;
        if (nextRole === target.role && nextStatus === target.status && !organizationChanged && !representativeChanged) {
          skipped.push({ userId, reason: "변경된 값이 없습니다." });
          continue;
        }

        if (target.role === "SUPER_ADMIN" && (nextRole !== "SUPER_ADMIN" || nextStatus !== "ACTIVE")) {
          const activeSuperAdmins = await tx.user.count({ where: { role: "SUPER_ADMIN", status: "ACTIVE" } });
          if (activeSuperAdmins <= 1) { skipped.push({ userId, reason: "마지막 활성 전체관리자는 변경하거나 정지할 수 없습니다." }); continue; }
        }

        if (target.role === "ADMIN" && nextRole !== "ADMIN") await tx.userSystemPermission.deleteMany({ where: { userId } });
        const downgradedMemberships = nextRole === "STUDENT"
          ? await tx.boardMember.updateMany({ where: { userId, role: { in: ["ADMIN", "EDITOR"] } }, data: { role: "MEMBER" } })
          : { count: 0 };
        await tx.user.update({
          where: { id: userId },
          data: {
            role: nextRole,
            status: nextStatus,
            ...(organizationChanged || nextRole !== target.role ? { schoolId: nextSchoolId, schoolGroupId: nextSchoolGroupId } : {}),
            ...(nextRole !== target.role && nextRole !== "STUDENT" ? { studentNumber: null } : {}),
            ...(representativeChanged ? { isSchoolRepresentative: nextIsSchoolRepresentative } : {}),
            authVersion: { increment: 1 },
          },
        });

        if (nextRole !== target.role) {
          await tx.adminAuditLog.create({ data: createAuditLogData({ actorId: actor.id, targetUserId: userId, action: "USER_ROLE_CHANGED", entityType: "User", entityId: userId, before: { role: target.role }, after: { role: nextRole, downgradedBoardMemberships: downgradedMemberships.count }, reason }) });
        }
        if (nextStatus !== target.status) {
          await tx.adminAuditLog.create({ data: createAuditLogData({ actorId: actor.id, targetUserId: userId, action: "USER_STATUS_CHANGED", entityType: "User", entityId: userId, before: { status: target.status }, after: { status: nextStatus }, reason }) });
        }
        if (organizationChanged) {
          await tx.adminAuditLog.create({ data: createAuditLogData({ actorId: actor.id, targetUserId: userId, action: "USER_ORGANIZATION_CHANGED", entityType: "User", entityId: userId, before: { schoolId: target.schoolId, schoolGroupId: target.schoolGroupId }, after: { schoolId: nextSchoolId, schoolGroupId: nextSchoolGroupId }, reason }) });
        }
        if (representativeChanged) {
          await tx.adminAuditLog.create({ data: createAuditLogData({ actorId: actor.id, targetUserId: userId, action: "SCHOOL_REPRESENTATIVE_REVOKED", entityType: "User", entityId: userId, before: { isSchoolRepresentative: true }, after: { isSchoolRepresentative: false }, reason }) });
        }
        updated.push(userId);
      }
    }, { isolationLevel: "Serializable" });

    return Response.json({ updated, skipped }, { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) {
    return apiError(error, "일괄 수정에 실패했습니다.");
  }
}

// 삭제는 행 단위 DELETE와 같은 비식별화(soft delete) 정책을 선택된 계정마다 적용합니다.
// 마지막 활성 전체관리자인 계정은 전체 작업을 실패시키지 않고 건너뛰어, 관리자가 나머지 안전한
// 대상은 한 번에 정리할 수 있게 합니다. 소유 패드가 있는 계정도 예전에는 같이 건너뛰었지만,
// 이제는 lib/board/succession.ts가 소유권을 승계시키므로 그대로 삭제합니다.
export async function DELETE(request: Request) {
  try {
    assertSameOrigin(request);
    const actor = await requireActiveUser();
    if (actor.role !== "SUPER_ADMIN") throw new AuthorizationError("회원 일괄 삭제는 전체관리자만 할 수 있습니다.");
    const parsed = bulkDeleteSchema.safeParse(await request.json());
    if (!parsed.success) return Response.json({ error: "삭제 대상과 3자 이상의 사유를 확인해 주세요." }, { status: 400 });

    const requestedIds = [...new Set(parsed.data.userIds)];
    const uniqueIds = requestedIds.filter((userId) => userId !== actor.id);
    const prisma = getPrisma();
    const targets = await prisma.user.findMany({
      where: { id: { in: uniqueIds }, status: { not: "DELETED" } },
      select: {
        id: true,
        role: true,
        status: true,
        schoolId: true,
        schoolGroupId: true,
        _count: { select: { ownedBoards: true } },
      },
    });
    const targetById = new Map(targets.map((target) => [target.id, target]));
    await requireRecentAuthentication(actor);

    const deleted: string[] = [];
    const skipped: { userId: string; reason: string }[] = requestedIds.includes(actor.id)
      ? [{ userId: actor.id, reason: "현재 로그인한 관리자 계정은 삭제할 수 없습니다." }]
      : [];

    await prisma.$transaction(async (tx) => {
      let activeSuperAdmins = await tx.user.count({ where: { role: "SUPER_ADMIN", status: "ACTIVE" } });
      for (const userId of uniqueIds) {
        const target = targetById.get(userId);
        if (!target) {
          skipped.push({ userId, reason: "사용자를 찾을 수 없습니다." });
          continue;
        }
        if (target.role === "SUPER_ADMIN" && target.status === "ACTIVE" && activeSuperAdmins <= 1) {
          skipped.push({ userId, reason: "마지막 활성 전체관리자는 삭제할 수 없습니다." });
          continue;
        }

        const deletedKey = randomUUID();
        await tx.userSystemPermission.deleteMany({ where: { userId } });
        // 승계가 먼저입니다 — 후보를 찾으려면 아직 target.schoolId가 살아 있어야 합니다.
        const successions = await succeedOwnedBoards(tx, userId, target.schoolId);
        const removedMemberships = await tx.boardMember.deleteMany({ where: { userId } });
        await tx.user.update({
          where: { id: userId },
          data: {
            status: "DELETED",
            authVersion: { increment: 1 },
            loginIdentifierLookup: `deleted:${deletedKey}`,
            loginIdentifierEncrypted: encryptUserLoginIdentifier(userId, `deleted-${deletedKey}`),
            nameEncrypted: encryptUserPii(userId, "name", "삭제된 사용자"),
            nameLookup: null,
            imageEncrypted: null,
            passwordHash: null,
            schoolId: null,
            schoolGroupId: null,
            studentNumber: null,
            isSchoolRepresentative: false,
          },
        });
        await tx.adminAuditLog.create({
          data: createAuditLogData({
            actorId: actor.id,
            targetUserId: userId,
            action: "USER_DELETED",
            entityType: "User",
            entityId: userId,
            before: { role: target.role, status: target.status, schoolId: target.schoolId, schoolGroupId: target.schoolGroupId },
            after: {
              status: "DELETED",
              personalDataRemoved: true,
              removedBoardMemberships: removedMemberships.count,
              boardSuccession: summarizeSuccessions(successions),
              bulk: true,
            },
            reason: parsed.data.reason,
          }),
        });
        if (target.role === "SUPER_ADMIN" && target.status === "ACTIVE") activeSuperAdmins -= 1;
        deleted.push(userId);
      }
    }, { isolationLevel: "Serializable" });

    await Promise.all(deleted.map((userId) => unlink(getAvatarPath(userId)).catch(() => undefined)));
    return Response.json(
      { updated: deleted, deleted, skipped },
      { headers: { "Cache-Control": "private, no-store" } },
    );
  } catch (error) {
    return apiError(error, "회원을 일괄 삭제하지 못했습니다.");
  }
}
