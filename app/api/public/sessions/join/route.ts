import { z } from "zod";
import { apiError, assertSameOrigin } from "@/lib/http";
import { readJsonWithLimit } from "@/lib/http-json";
import { getPrisma } from "@/lib/prisma";
import { createGuestToken, findGuestParticipant, hashGuestToken, readGuestToken, withGuestCookie } from "@/lib/quiz/guest-access";
import { assertPublicQuizInvalidPinRateLimit, assertPublicQuizJoinRateLimit } from "@/lib/security/public-quiz-rate-limit";
import { getCurrentUser } from "@/lib/auth/current-user";
import { assertCourseLiveAccess } from "@/lib/quiz/course-participation";

const JOIN_BODY_MAX_BYTES = 16 * 1024;

const bodySchema = z.object({
  pin: z.string().trim().regex(/^\d{6}$/, "PIN은 6자리 숫자입니다."),
  nickname: z.string().trim().min(1).max(40),
  subjectId: z.string().min(1).max(100).optional(),
});

export async function POST(request: Request) {
  try {
    assertSameOrigin(request);
    // 인증이 없는 경로라 PIN 전수 대입과 참여자 행 무한 생성이 모두 가능합니다.
    await assertPublicQuizJoinRateLimit(request);
    const { pin, nickname, subjectId } = bodySchema.parse(await readJsonWithLimit(request, JOIN_BODY_MAX_BYTES));
    const session = await getPrisma().quizSession.findUnique({
      where: { pinCode: pin },
      select: {
        id: true, mode: true, status: true, hostId: true, openAt: true, dueAt: true, allowLateSubmission: true, requiresLogin: true,
        quiz: { select: { deletedAt: true, subjectId: true, isPublished: true } },
      },
    });
    if (!session || session.requiresLogin) {
      // 정상 세션에 들어오는 한 반 전체와 PIN 전수 대입을 같은 학교 IP 버킷으로 세지 않습니다.
      assertPublicQuizInvalidPinRateLimit(request);
      throw new Error("공개 세션을 찾을 수 없습니다.");
    }
    if (subjectId) await assertCourseLiveAccess(session, subjectId, await getCurrentUser());
    // 링크 미리보기(utils/seo/sessionShare.ts)는 삭제된 퀴즈를 CLOSED로 가리는데 참여 자체는
    // 막히지 않았습니다. 잠긴 퀴즈(frozenAt)는 주인만 없을 뿐 유효하므로 그대로 받습니다.
    if (session.quiz.deletedAt) throw new Error("이미 종료된 세션입니다.");
    if (session.status === "FINISHED" || session.status === "CANCELLED") throw new Error("이미 종료된 세션입니다.");
    const now = new Date();
    if (session.mode === "ASYNC" && session.openAt && now < session.openAt) throw new Error("아직 공개되지 않은 과제입니다.");
    if (session.mode === "ASYNC" && session.dueAt && now > session.dueAt && !session.allowLateSubmission) throw new Error("마감된 과제입니다.");

    const currentToken = readGuestToken(request, session.id);
    const currentParticipant = await findGuestParticipant(session.id, currentToken);
    if (currentParticipant?.status === "KICKED") throw new Error("호스트가 이 세션에서 내보냈습니다.");
    if (currentParticipant) {
      return Response.json({ sessionId: session.id, participantId: currentParticipant.id, nickname: currentParticipant.nickname });
    }

    const guestToken = createGuestToken();
    const participant = await getPrisma().sessionParticipant.create({
      data: { sessionId: session.id, userId: null, nickname, guestTokenHash: hashGuestToken(guestToken) },
      select: { id: true, nickname: true },
    });
    return withGuestCookie(Response.json({ sessionId: session.id, participantId: participant.id, nickname: participant.nickname }), session.id, guestToken);
  } catch (error) {
    return apiError(error, "공개 세션에 참여하지 못했습니다.");
  }
}
