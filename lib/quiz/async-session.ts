import { getPrisma } from "@/lib/prisma";

export async function loadAsyncParticipation(sessionId: string, participantId: string) {
  const session = await getPrisma().quizSession.findUnique({
    where: { id: sessionId },
    include: { quiz: { include: { questions: { orderBy: { position: "asc" }, include: { choices: { orderBy: { position: "asc" } } } } } } },
  });
  if (!session) throw new Error("세션을 찾을 수 없습니다.");
  if (session.mode !== "ASYNC") throw new Error("이 세션은 자율 풀이 모드가 아닙니다. 실시간 진행은 소켓 이벤트를 사용하세요.");
  if (session.status === "FINISHED" || session.status === "CANCELLED") throw new Error("이미 마감된 과제입니다.");

  const participant = await getPrisma().sessionParticipant.findFirst({ where: { id: participantId, sessionId } });
  if (!participant) throw new Error("먼저 PIN으로 세션에 참여해 주세요.");
  if (participant.status === "KICKED") throw new Error("호스트가 이 세션에서 내보냈습니다.");

  const now = new Date();
  if (session.openAt && now < session.openAt) throw new Error("아직 시작 전인 과제입니다.");
  if (session.dueAt && now > session.dueAt && !session.allowLateSubmission) {
    throw new Error("마감된 과제입니다.");
  }

  return { session, participant };
}
