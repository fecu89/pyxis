import { z } from "zod";
import { canHostOrControlSession, requireActiveUser } from "@/lib/auth/authorization";
import { apiError, assertSameOrigin } from "@/lib/http";
import { getPrisma } from "@/lib/prisma";

const bulkDeleteSchema = z.object({ sessionIds: z.array(z.string().min(1)).min(1).max(100) });

// 결과 여러 개를 한 번에 삭제합니다. 권한이 없거나 아직 진행 중인 세션은 조용히 건너뛰고
// 개수로 알려줍니다 — 목록에서 섞어 선택해도 지울 수 있는 것만 지워지는 게 기대 동작이라서요.
export async function POST(request: Request) {
  try {
    assertSameOrigin(request);
    const actor = await requireActiveUser();
    const { sessionIds } = bulkDeleteSchema.parse(await request.json());

    const sessions = await getPrisma().quizSession.findMany({
      where: { id: { in: sessionIds } },
      select: { id: true, hostId: true, status: true },
    });
    const deletableIds = sessions
      .filter((session) => canHostOrControlSession(actor, session) && session.status !== "LOBBY" && session.status !== "IN_PROGRESS")
      .map((session) => session.id);

    if (deletableIds.length > 0) {
      // 활동을 지우면 QuizSession.activityId의 cascade로 세션이 함께 내려갑니다.
      await getPrisma().activity.deleteMany({ where: { quizSession: { id: { in: deletableIds } } } });
    }
    return Response.json({ deletedCount: deletableIds.length, skippedCount: sessionIds.length - deletableIds.length });
  } catch (error) {
    return apiError(error, "세션을 삭제하지 못했습니다.");
  }
}
