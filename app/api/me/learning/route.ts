import { z } from "zod";
import { requireActiveUser } from "@/lib/auth/authorization";
import { apiError } from "@/lib/http";
import { getLearningPage } from "@/lib/learning/queries";

const querySchema = z.object({
  kind: z.enum(["quiz", "pad", "form"]),
  subjectId: z.string().min(1).max(100).optional(),
  page: z.coerce.number().int().min(1).max(10000).default(1),
});

export async function GET(request: Request) {
  try {
    const user = await requireActiveUser();
    const input = querySchema.parse(Object.fromEntries(new URL(request.url).searchParams));
    return Response.json(await getLearningPage(user, input), { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) {
    return apiError(error, "참여 중인 활동을 불러오지 못했습니다.");
  }
}
