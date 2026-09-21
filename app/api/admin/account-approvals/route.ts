import { z } from "zod";
import { requireRole } from "@/lib/auth/authorization";
import { apiError } from "@/lib/http";
import { getRegistrationApprovalQueue } from "@/lib/users/registration-approvals";

const querySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().refine((value) => [10, 20, 50].includes(value)).default(20),
});

export async function GET(request: Request) {
  try {
    await requireRole(["SUPER_ADMIN"]);
    const parsed = querySchema.safeParse(Object.fromEntries(new URL(request.url).searchParams));
    if (!parsed.success) return Response.json({ error: "페이지 조건을 확인해 주세요." }, { status: 400 });
    return Response.json(await getRegistrationApprovalQueue(parsed.data), {
      headers: { "Cache-Control": "private, no-store" },
    });
  } catch (error) {
    return apiError(error, "가입 요청을 불러오지 못했습니다.");
  }
}
