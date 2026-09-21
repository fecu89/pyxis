import { requireActiveUser, canHostOrControlSession, AuthorizationError } from "@/lib/auth/authorization";
import { apiError, assertSameOrigin } from "@/lib/http";
import { getPrisma } from "@/lib/prisma";
import { disableQuizSessionShortLinks, invalidateShortLinkSlugs } from "@/lib/short-links/service";

export async function POST(request: Request, { params }: { params: Promise<{ sessionId: string }> }) {
  try {
    assertSameOrigin(request);
    const actor = await requireActiveUser();
    const { sessionId } = await params;

    const session = await getPrisma().quizSession.findUnique({ where: { id: sessionId } });
    if (!session) throw new AuthorizationError("세션을 찾을 수 없습니다.");
    if (!canHostOrControlSession(actor, session)) throw new AuthorizationError();

    // LIVE는 보통 socket의 host:end 이벤트로 종료하며 실시간 브로드캐스트까지 처리합니다.
    // 이 라우트는 호스트 연결이 끊겼을 때를 대비한 REST 대체 경로이자 ASYNC(과제) 마감용입니다.
    const disabledSlugs = await getPrisma().$transaction(async (tx) => {
      const endedAt = new Date();
      await tx.quizSession.update({
        where: { id: sessionId },
        data: {
          status: "FINISHED",
          livePhase: session.mode === "LIVE" ? "ENDED" : session.livePhase,
          endedAt,
          pinCode: null,
        },
      });
      // 연결만 끊고 slug 예약은 보존해 이미 배포한 QR을 다른 사용자가 가져가지 못하게 합니다.
      return disableQuizSessionShortLinks(tx, sessionId, endedAt);
    });
    invalidateShortLinkSlugs(disabledSlugs);

    return Response.json({ ok: true });
  } catch (error) {
    return apiError(error, "세션을 종료하지 못했습니다.");
  }
}
