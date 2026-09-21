import { z } from "zod";
import { requireActiveUser } from "@/lib/auth/authorization";
import { createAuditLogData } from "@/lib/auth/audit";
import { apiError, assertSameOrigin } from "@/lib/http";
import { getPrisma } from "@/lib/prisma";
import { findSchoolNicknameConflict } from "@/lib/users/nickname";
import { assertCanManageStudentClassMoves } from "@/lib/users/admin-policy";

// 여러 학생을 한 반으로 옮길 때 빈 출석번호를 한 트랜잭션에서 함께 확정합니다.
const moveSchema = z.object({
  userIds: z.array(z.string().min(1)).min(1).max(100),
  schoolGroupId: z.string().min(1),
  reason: z.string().trim().min(3).max(500),
});

export async function PATCH(request: Request) {
  try {
    assertSameOrigin(request);
    const actor = await requireActiveUser();
    const parsed = moveSchema.safeParse(await request.json());
    if (!parsed.success) return Response.json({ error: "학생, 이동할 반과 사유를 확인해 주세요." }, { status: 400 });

    const prisma = getPrisma();
    const userIds = [...new Set(parsed.data.userIds)];
    const targetGroup = await prisma.schoolGroup.findFirst({
      where: { id: parsed.data.schoolGroupId, type: "CLASS" },
      select: { id: true, schoolId: true, name: true },
    });
    if (!targetGroup) return Response.json({ error: "이동할 학생 반을 찾을 수 없습니다." }, { status: 404 });
    assertCanManageStudentClassMoves(actor, targetGroup.schoolId);

    const targets = await prisma.user.findMany({
      where: { id: { in: userIds }, role: "STUDENT", status: { not: "DELETED" } },
      select: { id: true, schoolId: true, schoolGroupId: true, studentNumber: true },
    });
    if (targets.length !== userIds.length) return Response.json({ error: "이동 대상에는 삭제되지 않은 학생만 포함할 수 있습니다." }, { status: 400 });
    for (const student of targets) {
      if (!student.schoolId) return Response.json({ error: "기존 학교가 지정되지 않은 학생은 먼저 소속을 정리해 주세요." }, { status: 409 });
      assertCanManageStudentClassMoves(actor, student.schoolId);
    }
    if (targets.every((student) => student.schoolGroupId === targetGroup.id)) {
      return Response.json({ error: "선택한 학생이 모두 이미 이 반에 소속되어 있습니다." }, { status: 409 });
    }

    const assignments = await prisma.$transaction(async (tx) => {
      // 같은 학교에서 여러 반 이동 요청이 겹쳐 번호가 중복되지 않도록 학교 단위로 잠급니다.
      await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended(${targetGroup.schoolId}, 0))::text AS locked`;
      const existing = await tx.user.findMany({
        where: { schoolGroupId: targetGroup.id, status: { not: "DELETED" }, id: { notIn: userIds } },
        select: { studentNumber: true },
      });
      const used = new Set(existing.flatMap(({ studentNumber }) => studentNumber === null ? [] : [studentNumber]));
      const available = Array.from({ length: 99 }, (_, index) => index + 1).filter((number) => !used.has(number));
      if (available.length < targets.length) throw new Error("도착 반에 배정할 수 있는 번호가 부족합니다.");

      // 다른 학교로 옮기는 학생만 닉네임을 다시 확인합니다. 같은 학교 안 이동은 학교가 그대로라
      // 학교 단위 닉네임 유일성이 깨지지 않습니다.
      const crossSchoolIds = targets.filter((student) => student.schoolId !== targetGroup.schoolId).map((student) => student.id);
      const nicknameConflict = await findSchoolNicknameConflict(tx, { schoolId: targetGroup.schoolId, userIds: crossSchoolIds });
      if (nicknameConflict) {
        throw new Error("도착 학교에 같은 닉네임을 쓰는 사용자가 있어 옮길 수 없습니다. 해당 학생의 닉네임을 먼저 바꿔 주세요.");
      }

      await tx.user.updateMany({ where: { id: { in: userIds } }, data: { schoolGroupId: null, studentNumber: null } });
      const moved = [] as { userId: string; studentNumber: number }[];
      for (const [index, student] of targets.entries()) {
        const studentNumber = available[index]!;
        await tx.user.update({
          where: { id: student.id },
          data: {
            schoolId: targetGroup.schoolId,
            schoolGroupId: targetGroup.id,
            studentNumber,
            authVersion: { increment: 1 },
          },
        });
        moved.push({ userId: student.id, studentNumber });
      }
      await tx.adminAuditLog.create({
        data: createAuditLogData({
          actorId: actor.id,
          action: "STUDENTS_CLASS_MOVED",
          entityType: "SchoolGroup",
          entityId: targetGroup.id,
          before: { students: targets },
          after: { schoolId: targetGroup.schoolId, schoolGroupId: targetGroup.id, assignments: moved },
          reason: parsed.data.reason,
        }),
      });
      return moved;
    }, { isolationLevel: "Serializable" });

    return Response.json({ moved: assignments, schoolGroup: { id: targetGroup.id, name: targetGroup.name } }, { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) {
    return apiError(error, "학생을 다른 반으로 이동하지 못했습니다.");
  }
}
