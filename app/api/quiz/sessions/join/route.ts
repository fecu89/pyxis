import { z } from "zod";
import { requireRole } from "@/lib/auth/authorization";
import { apiError, assertSameOrigin } from "@/lib/http";
import { readJsonWithLimit } from "@/lib/http-json";
import { getPrisma } from "@/lib/prisma";
import { assertRateLimit } from "@/lib/security/rate-limit";
import { assertCourseLiveAccess } from "@/lib/quiz/course-participation";

const bodySchema = z.object({ pin: z.string().trim().regex(/^\d{6}$/, "PIN은 6자리 숫자입니다."), subjectId: z.string().min(1).max(100).optional() });
const JOIN_BODY_MAX_BYTES = 16 * 1024;

export async function POST(request: Request) {
  try {
    assertSameOrigin(request);
    const actor = await requireRole(["STUDENT"]);
    // 로그인 학생은 계정별로 셉니다. 인증 전에 IP로 세면 학교 NAT 뒤 학생 20명이 서로의
    // 참여 횟수를 소모해 정상 PIN인데도 429를 받습니다.
    assertRateLimit(request, { scope: "session-join", userId: actor.id, windowMs: 60_000, maxAttempts: 20 });
    const { pin, subjectId } = bodySchema.parse(await readJsonWithLimit(request, JOIN_BODY_MAX_BYTES));
    const session = await getPrisma().quizSession.findUnique({
      where: { pinCode: pin },
      select: {
        id: true, mode: true, status: true, hostId: true, openAt: true, dueAt: true, allowLateSubmission: true, requiresLogin: true,
        quiz: { select: { deletedAt: true, subjectId: true, isPublished: true } },
      },
    });
    if (!session) throw new Error("PIN이 올바르지 않습니다.");
    if (subjectId) await assertCourseLiveAccess(session, subjectId, actor);
    // 목록(app/assignments/page.tsx)은 삭제된 퀴즈를 걸러내는데 여기서 안 보면 PIN을 아는 학생은
    // 계속 입장할 수 있었습니다. 잠긴 퀴즈(frozenAt)는 주인만 없을 뿐 유효하므로 그대로 받습니다.
    if (session.quiz.deletedAt) throw new Error("이미 종료된 세션입니다.");
    if (!session.requiresLogin) throw new Error("이 세션은 공개 참여 링크를 이용해 주세요.");
    if (session.status === "FINISHED" || session.status === "CANCELLED") throw new Error("이미 종료된 세션입니다.");
    if (session.hostId === actor.id) throw new Error("호스트는 참여자로 입장할 수 없습니다.");
    const now = new Date();
    if (session.mode === "ASYNC" && session.openAt && now < session.openAt) throw new Error("아직 공개되지 않은 과제입니다.");
    if (session.mode === "ASYNC" && session.dueAt && now > session.dueAt && !session.allowLateSubmission) throw new Error("마감된 과제입니다.");

    const existing = await getPrisma().sessionParticipant.findUnique({
      where: { sessionId_userId: { sessionId: session.id, userId: actor.id } },
      select: { status: true },
    });
    if (existing?.status === "KICKED") throw new Error("호스트가 이 세션에서 내보냈습니다.");
    const participant = await getPrisma().sessionParticipant.upsert({
      where: { sessionId_userId: { sessionId: session.id, userId: actor.id } },
      update: {},
      create: { sessionId: session.id, userId: actor.id, nickname: actor.name ?? actor.loginId ?? "참가자" },
      select: { id: true, nickname: true },
    });
    return Response.json({ sessionId: session.id, participantId: participant.id, nickname: participant.nickname });
  } catch (error) {
    return apiError(error, "세션에 참여하지 못했습니다.");
  }
}
