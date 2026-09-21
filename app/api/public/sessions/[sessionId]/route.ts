import { apiError } from "@/lib/http";
import { loadPublicQuizSessionData } from "@/lib/quiz/session-data";

export async function GET(request: Request, { params }: { params: Promise<{ sessionId: string }> }) {
  try {
    const { sessionId } = await params;
    return Response.json(await loadPublicQuizSessionData(request, sessionId));
  } catch (error) {
    return apiError(error, "공개 세션 정보를 불러오지 못했습니다.");
  }
}
