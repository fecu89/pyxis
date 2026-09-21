import { z } from "zod";
import { AuthorizationError, requireActiveUser } from "@/lib/auth/authorization";
import { apiError } from "@/lib/http";
import { getTeacherApprovalQueue } from "@/lib/users/teacher-approvals";

const querySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().refine((value) => [10, 20, 50].includes(value)).default(20),
});

export async function GET(request: Request) {
  try {
    const actor = await requireActiveUser();
    const representativeSchoolId = actor.role === "TEACHER"
      && actor.isSchoolRepresentative
      && actor.school
      ? actor.school.id
      : null;
    if (actor.role !== "SUPER_ADMIN" && !representativeSchoolId) {
      throw new AuthorizationError("교사 가입 요청을 확인할 권한이 없습니다.");
    }
    const parsed = querySchema.safeParse(Object.fromEntries(new URL(request.url).searchParams));
    if (!parsed.success) {
      return Response.json({ error: "페이지 조건을 확인해 주세요." }, { status: 400 });
    }
    const result = await getTeacherApprovalQueue({
      schoolId: representativeSchoolId ?? undefined,
      page: parsed.data.page,
      pageSize: parsed.data.pageSize,
    });
    return Response.json(result, { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) {
    return apiError(error, "교사 가입 요청을 불러오지 못했습니다.");
  }
}
