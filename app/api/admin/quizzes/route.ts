import { z } from "zod";
import { AuthorizationError, canViewAllQuizzes, requireActiveUser } from "@/lib/auth/authorization";
import { credentialLoginIdValueSchema } from "@/lib/auth/credentials";
import { getAdminQuizPage } from "@/lib/quiz/admin-queries";
import { apiError } from "@/lib/http";
import { createLoginIdentifierLookup } from "@/lib/security/pii-crypto";

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "날짜 형식을 확인해 주세요.");

const listQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().refine((value) => [10, 25, 50].includes(value), "페이지 크기는 10·25·50 중 하나여야 합니다.").default(20),
  search: z.string().trim().min(1).max(100).optional(),
  includeArchived: z.coerce.boolean().default(false),
  ownerLoginId: credentialLoginIdValueSchema.optional(),
  ownerEmail: z.email().transform((value) => value.trim().normalize("NFKC").toLocaleLowerCase("en-US")).optional(),
  updatedFrom: isoDate.optional(),
  updatedTo: isoDate.optional(),
  sortBy: z.enum(["title", "updatedAt", "questions", "sessions"]).default("updatedAt"),
  sortDir: z.enum(["asc", "desc"]).default("desc"),
});

// 관리자 센터 "전체 퀴즈" 탭 전용입니다. app/api/admin/boards/route.ts와 같은 이유로
// VIEW_ALL_QUIZZES(또는 EDIT_ANY_QUIZ) 권한자만 플랫폼 전체 퀴즈를 훑어볼 수 있게 따로 열어둡니다.
// lib/forms/list.ts도 같은 권한으로 "전체 설문 조회"를 판정하므로, 별도의 VIEW_ALL_FORMS
// 권한을 새로 만들지 않고 canViewAllQuizzes 하나를 퀴즈·설문 두 admin 탭에 재사용합니다.
export async function GET(request: Request) {
  try {
    const actor = await requireActiveUser();
    if (!canViewAllQuizzes(actor)) throw new AuthorizationError();
    const url = new URL(request.url);
    const parsed = listQuerySchema.safeParse(Object.fromEntries(url.searchParams));
    if (!parsed.success) return Response.json({ error: "검색 조건을 확인해 주세요." }, { status: 400 });
    const { ownerLoginId, ownerEmail, updatedFrom, updatedTo, ...rest } = parsed.data;
    const ownerIdentifier = ownerLoginId ?? ownerEmail;
    const result = await getAdminQuizPage({
      ...rest,
      ownerLoginIdentifierLookup: ownerIdentifier ? createLoginIdentifierLookup(ownerIdentifier) : undefined,
      updatedFrom: updatedFrom ? new Date(`${updatedFrom}T00:00:00.000Z`) : undefined,
      updatedTo: updatedTo ? new Date(`${updatedTo}T23:59:59.999Z`) : undefined,
    });
    return Response.json(result, { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) {
    return apiError(error, "퀴즈 목록을 불러오지 못했습니다.");
  }
}
