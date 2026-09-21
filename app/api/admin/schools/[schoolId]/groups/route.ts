import { z } from "zod";
import { requireActiveUser } from "@/lib/auth/authorization";
import { createAuditLogData } from "@/lib/auth/audit";
import { apiError, assertSameOrigin } from "@/lib/http";
import { getPrisma } from "@/lib/prisma";
import { assertCanManageSchoolGroups } from "@/lib/users/admin-policy";

const maxGradeByLevel = { ELEMENTARY: 6, MIDDLE: 3, HIGH: 3 } as const;

const createGroupSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("CLASS"),
    grade: z.number().int().min(1).max(12),
    classNumber: z.number().int().min(1).max(99),
  }),
  z.object({
    type: z.literal("DEPARTMENT"),
    name: z.string().trim().min(1).max(100),
  }),
]);

export async function POST(request: Request, { params }: { params: Promise<{ schoolId: string }> }) {
  try {
    assertSameOrigin(request);
    const actor = await requireActiveUser();
    const { schoolId } = await params;
    assertCanManageSchoolGroups(actor, schoolId);
    const parsed = createGroupSchema.safeParse(await request.json());
    if (!parsed.success) return Response.json({ error: "학년·반 번호 또는 부서 이름을 확인해 주세요." }, { status: 400 });

    const prisma = getPrisma();
    const school = await prisma.school.findUnique({ where: { id: schoolId }, select: { id: true, level: true } });
    if (!school) return Response.json({ error: "학교를 찾을 수 없습니다." }, { status: 404 });
    if (parsed.data.type === "CLASS" && parsed.data.grade > maxGradeByLevel[school.level]) {
      return Response.json({ error: `${school.level === "ELEMENTARY" ? "초등학교" : school.level === "MIDDLE" ? "중학교" : "고등학교"}는 ${maxGradeByLevel[school.level]}학년까지만 학급을 만들 수 있습니다.` }, { status: 400 });
    }
    const group = await prisma.$transaction(async (tx) => {
      const grade = parsed.data.type === "CLASS"
        ? await tx.schoolGrade.upsert({
          where: { schoolId_grade: { schoolId, grade: parsed.data.grade } },
          update: {},
          create: { schoolId, grade: parsed.data.grade },
          select: { id: true, grade: true },
        })
        : null;
      const name = parsed.data.type === "CLASS"
        ? `${parsed.data.grade}학년 ${parsed.data.classNumber}반`
        : parsed.data.name;
      const duplicate = parsed.data.type === "CLASS"
        ? await tx.schoolGroup.findUnique({
          where: { gradeId_classNumber: { gradeId: grade!.id, classNumber: parsed.data.classNumber } },
          select: { id: true },
        })
        : await tx.schoolGroup.findFirst({ where: { schoolId, type: "DEPARTMENT", name }, select: { id: true } });
      if (duplicate) throw new Error(parsed.data.type === "CLASS" ? "같은 학년의 반이 이미 있습니다." : "같은 이름의 부서가 이미 있습니다.");
      const created = await tx.schoolGroup.create({
        data: {
          schoolId,
          name,
          type: parsed.data.type,
          gradeId: grade?.id ?? null,
          classNumber: parsed.data.type === "CLASS" ? parsed.data.classNumber : null,
        },
        select: { id: true, name: true, type: true, classNumber: true, grade: { select: { grade: true } } },
      });
      await tx.adminAuditLog.create({
        data: createAuditLogData({
          actorId: actor.id,
          action: "SCHOOL_GROUP_CREATED",
          entityType: "SchoolGroup",
          entityId: created.id,
          after: {
            schoolId,
            name: created.name,
            type: created.type,
            grade: created.grade?.grade ?? null,
            classNumber: created.classNumber,
          },
        }),
      });
      return created;
    });
    return Response.json({
      group: {
        id: group.id,
        name: group.name,
        type: group.type,
        grade: group.grade?.grade ?? null,
        classNumber: group.classNumber,
        userCount: 0,
        isDefault: false,
      },
    }, { status: 201 });
  } catch (error) {
    return apiError(error, "반·부서를 추가하지 못했습니다.");
  }
}
