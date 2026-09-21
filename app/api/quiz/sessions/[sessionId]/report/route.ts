import { requireActiveUser } from "@/lib/auth/authorization";
import { buildSessionReport } from "@/lib/quiz/report";
import { apiError } from "@/lib/http";

export async function GET(_request: Request, { params }: { params: Promise<{ sessionId: string }> }) {
  try {
    const actor = await requireActiveUser();
    const { sessionId } = await params;
    const report = await buildSessionReport(sessionId, actor);
    return Response.json(report);
  } catch (error) {
    return apiError(error, "결과 리포트를 불러오지 못했습니다.");
  }
}
