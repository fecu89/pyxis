import { apiError } from "@/lib/http";
import { requirePublicParticipation } from "@/lib/quiz/guest-access";
import { buildParticipantSessionReport } from "@/lib/quiz/report";
import { assertPublicQuizApiRateLimit } from "@/lib/security/public-quiz-rate-limit";

export async function GET(request: Request, { params }: { params: Promise<{ sessionId: string }> }) {
  try {
    const { sessionId } = await params;
    const { participant } = await requirePublicParticipation(request, sessionId);
    await assertPublicQuizApiRateLimit(request, participant.id);
    return Response.json(await buildParticipantSessionReport(sessionId, participant.id));
  } catch (error) {
    return apiError(error, "공개 퀴즈 결과를 불러오지 못했습니다.");
  }
}
