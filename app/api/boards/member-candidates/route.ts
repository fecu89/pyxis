import { requireActiveUser } from "@/lib/auth/authorization";
import { listBoardMemberCandidates } from "@/lib/board/member-candidates";
import { apiError } from "@/lib/http";

export async function GET(request: Request) {
  try {
    const current = await requireActiveUser();
    const query = new URL(request.url).searchParams.get("q") ?? "";
    return Response.json(await listBoardMemberCandidates(current, { query }));
  } catch (error) {
    return apiError(error, "멤버 후보를 불러오지 못했습니다.");
  }
}
