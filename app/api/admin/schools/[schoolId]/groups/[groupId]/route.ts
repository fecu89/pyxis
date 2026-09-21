import { z } from "zod";
import { requireActiveUser } from "@/lib/auth/authorization";
import { createAuditLogData } from "@/lib/auth/audit";
import { apiError, assertSameOrigin } from "@/lib/http";
import { getPrisma } from "@/lib/prisma";
import { assertCanManageSchoolGroups } from "@/lib/users/admin-policy";
import { DEFAULT_STUDENT_GROUP_ID, DEFAULT_TEACHER_GROUP_ID } from "@/lib/users/organization";

const maxGradeByLevel = { ELEMENTARY: 6, MIDDLE: 3, HIGH: 3 } as const;

// 학급과 부서의 공통 식별자 경로에서 유형별 수정 가능 필드를 엄격하게 나눕니다.
const updateGroupSchema = z.object({
  name: z.string().trim().min(1).max(100).optional(),
  grade: z.number().int().min(1).max(12).optional(),
  classNumber: z.number().int().min(1).max(99).optional(),
}).refine(
  (value) => value.name !== undefined
    || value.grade !== undefined
    || value.classNumber !== undefined,
  "변경할 값을 입력해 주세요.",
);

export async function PATCH(request: Request, { params }: { params: Promise<{ schoolId: string; groupId: string }> }) {
  try {
    assertSameOrigin(request);
    const actor = await requireActiveUser();
    const { schoolId, groupId } = await params;
    assertCanManageSchoolGroups(actor, schoolId);
    const parsed = updateGroupSchema.safeParse(await request.json());
    if (!parsed.success) return Response.json({ error: "학년·반 번호 또는 부서 이름을 확인해 주세요." }, { status: 400 });

    const prisma = getPrisma();
    const group = await prisma.schoolGroup.findFirst({
      where: { id: groupId, schoolId },
      select: {
        id: true,
        name: true,
        type: true,
        gradeId: true,
        classNumber: true,
        school: { select: { level: true } },
        grade: { select: { grade: true } },
        _count: { select: { users: true } },
      },
    });
    if (!group) return Response.json({ error: "반·부서를 찾을 수 없습니다." }, { status: 404 });

    if (group.type === "CLASS" && parsed.data.name !== undefined) {
      return Response.json({ error: "학생 반은 학년과 반 번호로 변경해 주세요." }, { status: 400 });
    }
    if (group.type === "DEPARTMENT" && (parsed.data.grade !== undefined
      || parsed.data.classNumber !== undefined)) {
      return Response.json({ error: "교사 부서는 부서 이름만 변경할 수 있습니다." }, { status: 400 });
    }

    const nextGrade = parsed.data.grade ?? group.grade?.grade ?? null;
    const nextClassNumber = parsed.data.classNumber ?? group.classNumber;
    const nextName = group.type === "CLASS"
      ? nextGrade && nextClassNumber ? `${nextGrade}학년 ${nextClassNumber}반` : group.name
      : parsed.data.name ?? group.name;
    if (group.type === "CLASS" && (!nextGrade || !nextClassNumber)) {
      return Response.json({ error: "이전 형식의 학급입니다. 학년과 반 번호를 모두 지정해 주세요." }, { status: 400 });
    }
    if (group.type === "CLASS" && nextGrade! > maxGradeByLevel[group.school.level]) {
      return Response.json({ error: `${group.school.level === "ELEMENTARY" ? "초등학교" : group.school.level === "MIDDLE" ? "중학교" : "고등학교"}는 ${maxGradeByLevel[group.school.level]}학년까지만 학급을 만들 수 있습니다.` }, { status: 400 });
    }
    const unchanged = nextName === group.name
      && nextGrade === (group.grade?.grade ?? null)
      && nextClassNumber === group.classNumber;
    if (unchanged) return Response.json({ error: "변경된 값이 없습니다." }, { status: 409 });

    const updated = await prisma.$transaction(async (tx) => {
      const grade = group.type === "CLASS"
        ? await tx.schoolGrade.upsert({
          where: { schoolId_grade: { schoolId, grade: nextGrade! } },
          update: {},
          create: { schoolId, grade: nextGrade! },
          select: { id: true, grade: true },
        })
        : null;
      const duplicate = group.type === "CLASS"
        ? await tx.schoolGroup.findFirst({
          where: { gradeId: grade!.id, classNumber: nextClassNumber, id: { not: groupId } },
          select: { id: true },
        })
        : await tx.schoolGroup.findFirst({
          where: { schoolId, type: "DEPARTMENT", name: nextName, id: { not: groupId } },
          select: { id: true },
        });
      if (duplicate) throw new Error(group.type === "CLASS" ? "같은 학년의 반이 이미 있습니다." : "같은 이름의 부서가 이미 있습니다.");
      const next = await tx.schoolGroup.update({
        where: { id: groupId },
        data: {
          name: nextName,
          gradeId: grade?.id ?? null,
          classNumber: group.type === "CLASS" ? nextClassNumber : null,
        },
        select: { id: true, name: true, type: true, classNumber: true, grade: { select: { grade: true } } },
      });
      await tx.adminAuditLog.create({
        data: createAuditLogData({
          actorId: actor.id,
          action: "SCHOOL_GROUP_UPDATED",
          entityType: "SchoolGroup",
          entityId: groupId,
          before: {
            name: group.name,
            type: group.type,
            grade: group.grade?.grade ?? null,
            classNumber: group.classNumber,
          },
          after: {
            name: next.name,
            type: next.type,
            grade: next.grade?.grade ?? null,
            classNumber: next.classNumber,
          },
        }),
      });
      if (group.gradeId && group.gradeId !== grade?.id) {
        const remaining = await tx.schoolGroup.count({ where: { gradeId: group.gradeId } });
        if (remaining === 0) await tx.schoolGrade.delete({ where: { id: group.gradeId } });
      }
      return next;
    });
    return Response.json({
      group: {
        id: updated.id,
        name: updated.name,
        type: updated.type,
        grade: updated.grade?.grade ?? null,
        classNumber: updated.classNumber,
        userCount: group._count.users,
      },
    });
  } catch (error) {
    return apiError(error, "반·부서 정보를 변경하지 못했습니다.");
  }
}

export async function DELETE(request: Request, { params }: { params: Promise<{ schoolId: string; groupId: string }> }) {
  try {
    assertSameOrigin(request);
    const actor = await requireActiveUser();
    const { schoolId, groupId } = await params;
    assertCanManageSchoolGroups(actor, schoolId);
    if (groupId === DEFAULT_STUDENT_GROUP_ID || groupId === DEFAULT_TEACHER_GROUP_ID) {
      return Response.json({ error: "서비스 초기 반·부서 데이터는 삭제할 수 없습니다." }, { status: 409 });
    }

    const prisma = getPrisma();
    const group = await prisma.schoolGroup.findFirst({
      where: { id: groupId, schoolId },
      select: { id: true, name: true, type: true, gradeId: true, classNumber: true, grade: { select: { grade: true } }, _count: { select: { users: true } } },
    });
    if (!group) return Response.json({ error: "반·부서를 찾을 수 없습니다." }, { status: 404 });

    const affectedUsers = group._count.users;
    await prisma.$transaction(async (tx) => {
      await tx.schoolGroup.delete({ where: { id: groupId } });
      if (group.gradeId) {
        const remaining = await tx.schoolGroup.count({ where: { gradeId: group.gradeId } });
        if (remaining === 0) await tx.schoolGrade.delete({ where: { id: group.gradeId } });
      }
      await tx.adminAuditLog.create({
        data: createAuditLogData({
          actorId: actor.id,
          action: "SCHOOL_GROUP_DELETED",
          entityType: "SchoolGroup",
          entityId: groupId,
          before: { name: group.name, type: group.type, grade: group.grade?.grade ?? null, classNumber: group.classNumber, affectedUsers },
        }),
      });
    });
    return Response.json({ ok: true, groupId, affectedUsers });
  } catch (error) {
    return apiError(error, "반·부서를 삭제하지 못했습니다.");
  }
}
