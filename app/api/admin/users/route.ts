import { z } from "zod";
import { AuthorizationError, hasSystemPermission, requireActiveUser } from "@/lib/auth/authorization";
import { credentialLoginIdValueSchema } from "@/lib/auth/credentials";
import { apiError } from "@/lib/http";
import { getAdminUserPage } from "@/lib/users/repository";

const querySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().refine((value) => [10, 50, 100].includes(value), "페이지 크기는 10·50·100 중 하나여야 합니다.").default(10),
  role: z.enum(["SUPER_ADMIN", "ADMIN", "TEACHER", "STUDENT"]).optional(),
  status: z.enum(["ACTIVE", "SUSPENDED"]).optional(),
  loginId: credentialLoginIdValueSchema.optional(),
  email: z.email().transform((value) => value.trim().normalize("NFKC").toLocaleLowerCase("en-US")).optional(),
  q: z.string().trim().min(1).max(100).optional(),
  schoolId: z.string().min(1).optional(),
  schoolGroupId: z.string().min(1).optional(),
});

export async function GET(request: Request) {
  try {
    const actor = await requireActiveUser();
    const isSchoolTeacher = actor.role === "TEACHER";
    if (!hasSystemPermission(actor, "VIEW_USERS") && !isSchoolTeacher) {
      throw new AuthorizationError();
    }
    if (isSchoolTeacher && !actor.school) {
      throw new AuthorizationError();
    }
    const url = new URL(request.url);
    const parsed = querySchema.safeParse(Object.fromEntries(url.searchParams));
    if (!parsed.success) return Response.json({ error: "검색 조건을 확인해 주세요." }, { status: 400 });
    const { page, pageSize, role, status, loginId, email, q, schoolId, schoolGroupId } = parsed.data;
    // 교사는 대표 여부나 추가 시스템 권한과 관계없이 자기 학교 명단만 조회합니다.
    const scopedSchoolId = isSchoolTeacher
      ? actor.school!.id
      : schoolId;
    const result = await getAdminUserPage({ page, pageSize, role, status, schoolId: scopedSchoolId, schoolGroupId, query: q ?? loginId ?? email });
    return Response.json(
      result,
      { headers: { "Cache-Control": "private, no-store" } },
    );
  } catch (error) {
    return apiError(error, "사용자 목록을 불러오지 못했습니다.");
  }
}
