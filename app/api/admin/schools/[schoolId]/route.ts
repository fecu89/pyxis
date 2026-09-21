import { z } from "zod";
import { requireRole } from "@/lib/auth/authorization";
import { createAuditLogData } from "@/lib/auth/audit";
import { apiError, assertSameOrigin } from "@/lib/http";
import { getPrisma } from "@/lib/prisma";
import { DEFAULT_SCHOOL_ID } from "@/lib/users/organization";

const maxGradeByLevel = { ELEMENTARY: 6, MIDDLE: 3, HIGH: 3 } as const;

const updateSchoolSchema = z.object({
  name: z.string().trim().min(1).max(100).optional(),
  code: z.string().trim().min(1).max(20).regex(/^[A-Za-z0-9_-]+$/).nullable().optional(),
  level: z.enum(["ELEMENTARY", "MIDDLE", "HIGH"]).optional(),
  district: z.string().trim().max(100).nullable().optional(),
  operatingStatus: z.enum(["OPERATING", "PLANNED", "INACTIVE"]).optional(),
}).refine((value) => Object.values(value).some((item) => item !== undefined), "변경할 값을 입력해 주세요.");

export async function PATCH(request: Request, { params }: { params: Promise<{ schoolId: string }> }) {
  try {
    assertSameOrigin(request);
    const actor = await requireRole(["SUPER_ADMIN"]);
    const { schoolId } = await params;
    const parsed = updateSchoolSchema.safeParse(await request.json());
    if (!parsed.success) return Response.json({ error: "학교 정보를 확인해 주세요." }, { status: 400 });

    const prisma = getPrisma();
    const school = await prisma.school.findUnique({ where: { id: schoolId }, select: { id: true, name: true, code: true, level: true, district: true, operatingStatus: true } });
    if (!school) return Response.json({ error: "학교를 찾을 수 없습니다." }, { status: 404 });
    const next = {
      name: parsed.data.name ?? school.name,
      code: parsed.data.code !== undefined ? parsed.data.code?.toUpperCase() || null : school.code,
      level: parsed.data.level ?? school.level,
      district: parsed.data.district !== undefined ? parsed.data.district || null : school.district,
      operatingStatus: parsed.data.operatingStatus ?? school.operatingStatus,
    };
    if (Object.entries(next).every(([key, value]) => school[key as keyof typeof school] === value)) return Response.json({ error: "변경된 정보가 없습니다." }, { status: 409 });
    const duplicate = await prisma.school.findFirst({
      where: { id: { not: schoolId }, OR: [{ name: next.name }, ...(next.code ? [{ code: next.code }] : [])] },
      select: { name: true, code: true },
    });
    if (duplicate) return Response.json({ error: duplicate.name === next.name ? "같은 이름의 학교가 이미 있습니다." : "같은 학교 코드가 이미 있습니다." }, { status: 409 });
    if (next.level !== school.level) {
      const outOfRangeClass = await prisma.schoolGroup.findFirst({
        where: { schoolId, type: "CLASS", grade: { is: { grade: { gt: maxGradeByLevel[next.level] } } } },
        select: { name: true },
      });
      if (outOfRangeClass) {
        return Response.json({ error: `${outOfRangeClass.name}을 먼저 정리해야 학교 급별을 변경할 수 있습니다.` }, { status: 409 });
      }
    }

    const updated = await prisma.$transaction(async (tx) => {
      const updatedSchool = await tx.school.update({ where: { id: schoolId }, data: next, select: { id: true, name: true, code: true, level: true, district: true, operatingStatus: true } });
      await tx.adminAuditLog.create({
        data: createAuditLogData({
          actorId: actor.id,
          action: "SCHOOL_UPDATED",
          entityType: "School",
          entityId: schoolId,
          before: school,
          after: updatedSchool,
        }),
      });
      return updatedSchool;
    });
    return Response.json({ school: updated });
  } catch (error) {
    return apiError(error, "학교 이름을 변경하지 못했습니다.");
  }
}

export async function DELETE(request: Request, { params }: { params: Promise<{ schoolId: string }> }) {
  try {
    assertSameOrigin(request);
    const actor = await requireRole(["SUPER_ADMIN"]);
    const { schoolId } = await params;
    if (schoolId === DEFAULT_SCHOOL_ID) {
      return Response.json({ error: "서비스 초기 학교 데이터는 삭제할 수 없습니다." }, { status: 409 });
    }

    const prisma = getPrisma();
    const school = await prisma.school.findUnique({
      where: { id: schoolId },
      select: { id: true, name: true, _count: { select: { users: true, groups: true } } },
    });
    if (!school) return Response.json({ error: "학교를 찾을 수 없습니다." }, { status: 404 });

    const affectedUsers = school._count.users;
    await prisma.$transaction(async (tx) => {
      // School.groups는 onDelete: Cascade, User.schoolId/schoolGroupId는 onDelete: SetNull이라
      // 삭제 한 번으로 반/부서까지 정리되고 소속 사용자는 "미지정" 상태가 됩니다.
      await tx.school.delete({ where: { id: schoolId } });
      await tx.adminAuditLog.create({
        data: createAuditLogData({
          actorId: actor.id,
          action: "SCHOOL_DELETED",
          entityType: "School",
          entityId: schoolId,
          before: { name: school.name, groupCount: school._count.groups, affectedUsers },
        }),
      });
    });
    return Response.json({ ok: true, schoolId, affectedUsers });
  } catch (error) {
    return apiError(error, "학교를 삭제하지 못했습니다.");
  }
}
