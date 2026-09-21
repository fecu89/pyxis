import { z } from "zod";
import { AuthorizationError, canViewSchoolDirectory, requireActiveUser, requireRole } from "@/lib/auth/authorization";
import { createAuditLogData } from "@/lib/auth/audit";
import { apiError, assertSameOrigin } from "@/lib/http";
import { getPrisma } from "@/lib/prisma";
import { getAdminSchoolPage } from "@/lib/users/organization";

const createSchoolSchema = z.object({
  name: z.string().trim().min(1).max(100),
  code: z.string().trim().min(1).max(20).regex(/^[A-Za-z0-9_-]+$/).nullable().optional(),
  level: z.enum(["ELEMENTARY", "MIDDLE", "HIGH"]).default("HIGH"),
  district: z.string().trim().max(100).nullable().optional(),
  operatingStatus: z.enum(["OPERATING", "PLANNED", "INACTIVE"]).default("OPERATING"),
});

const listQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().refine((value) => [10, 25, 50].includes(value), "페이지 크기는 10·25·50 중 하나여야 합니다.").default(20),
  search: z.string().trim().min(1).max(100).optional(),
});

// "소속 관리" 탭이 학교별 활성 교사 명단까지 포함한 페이지 단위 데이터를 직접 client fetch로
// 받아가는 라우트입니다. 화면 노출 조건(app/admin/page.tsx의 canViewSchools)과 동일한 기준을
// canViewSchoolDirectory로 공유해, 탭이 보이는데 API만 막혀 있는 상황이 생기지 않게 합니다.
export async function GET(request: Request) {
  try {
    const actor = await requireActiveUser();
    if (!canViewSchoolDirectory(actor)) throw new AuthorizationError();
    const url = new URL(request.url);
    const parsed = listQuerySchema.safeParse(Object.fromEntries(url.searchParams));
    if (!parsed.success) return Response.json({ error: "검색 조건을 확인해 주세요." }, { status: 400 });
    // 학교 대표교사는 시스템 권한과 무관하게 자기 학교만 볼 수 있습니다(사용자 목록 라우트와 동일한 스코프).
    const scopedSchoolId = actor.role === "TEACHER" ? actor.school?.id : undefined;
    const result = await getAdminSchoolPage({ ...parsed.data, schoolId: scopedSchoolId });
    return Response.json(result, { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) {
    return apiError(error, "학교 목록을 불러오지 못했습니다.");
  }
}

export async function POST(request: Request) {
  try {
    assertSameOrigin(request);
    const actor = await requireRole(["SUPER_ADMIN"]);
    const parsed = createSchoolSchema.safeParse(await request.json());
    if (!parsed.success) return Response.json({ error: "학교 이름을 확인해 주세요." }, { status: 400 });

    const prisma = getPrisma();
    const normalizedCode = parsed.data.code?.toUpperCase() || null;
    const existing = await prisma.school.findFirst({
      where: { OR: [{ name: parsed.data.name }, ...(normalizedCode ? [{ code: normalizedCode }] : [])] },
      select: { name: true, code: true },
    });
    if (existing) return Response.json({ error: existing.name === parsed.data.name ? "같은 이름의 학교가 이미 있습니다." : "같은 학교 코드가 이미 있습니다." }, { status: 409 });

    const school = await prisma.$transaction(async (tx) => {
      const created = await tx.school.create({
        data: {
          name: parsed.data.name,
          code: normalizedCode,
          level: parsed.data.level,
          district: parsed.data.district || null,
          operatingStatus: parsed.data.operatingStatus,
        },
        select: { id: true, name: true, code: true, level: true, district: true, operatingStatus: true },
      });
      await tx.adminAuditLog.create({
        data: createAuditLogData({
          actorId: actor.id,
          action: "SCHOOL_CREATED",
          entityType: "School",
          entityId: created.id,
          after: created,
        }),
      });
      return created;
    });
    return Response.json({ school: { ...school, userCount: 0, studentCount: 0, teacherCount: 0, unnumberedStudentCount: 0, unassignedStudentCount: 0, isDefault: false, teachers: [], groups: [] } }, { status: 201 });
  } catch (error) {
    return apiError(error, "학교를 추가하지 못했습니다.");
  }
}
