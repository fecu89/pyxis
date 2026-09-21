import "server-only";

import { parse } from "cookie";
import { getCurrentUser } from "@/lib/auth/current-user";
import { getPrisma } from "@/lib/prisma";
import { getQuizAccess } from "@/lib/quiz/access";
import { hashGuestToken } from "@/lib/quiz/guest-access";

// 문항 이미지가 data URL이던 시절에는 소켓 페이로드에 바이트가 실려 나가서 별도 판정이
// 필요 없었습니다. 파일로 바뀌면 참여자가 주소로 따로 받아가므로, "이 사람이 이 퀴즈의
// 문항을 볼 자격이 있는가"를 여기서 한 번에 답합니다.
//
// 볼 수 있는 사람은 셋입니다.
//   1. 퀴즈에 접근 권한이 있는 로그인 사용자(소유자·공유받은 사람·탐색 열람자·관리자)
//   2. 이 퀴즈의 세션에 참여 등록된 로그인 학생
//   3. 이 퀴즈의 공개 세션에 닉네임으로 들어온 손님(세션별 HttpOnly 쿠키 보유)
//
// 2·3이 없으면 수업 중 학생 화면에서 문항 이미지가 통째로 깨집니다 — 학생은 퀴즈 자체에는
// 접근 권한이 없기 때문입니다.

const GUEST_COOKIE_PREFIX = "quiz_guest_";
const SESSION_ID_PATTERN = /^[a-z0-9-]{1,64}$/i;
const MAX_GUEST_COOKIE_CANDIDATES = 20;
const MAX_GUEST_TOKEN_LENGTH = 128;

export async function canViewQuizImage(request: Request, quizId: string) {
  const prisma = getPrisma();

  const user = await getCurrentUser();
  if (user) {
    if (await getQuizAccess(quizId, user)) return true;
    const participant = await prisma.sessionParticipant.findFirst({
      where: { userId: user.id, status: { not: "KICKED" }, session: { quizId } },
      select: { id: true },
    });
    if (participant) return true;
  }

  // 손님 쿠키는 세션마다 따로 발급되므로(quiz_guest_{sessionId}) 이름에서 세션 ID를 뽑아
  // 그중 이 퀴즈에 속한 세션만 추립니다. 브라우저가 들고 있는 쿠키 수만큼이라 목록은 짧습니다.
  const cookies = parse(request.headers.get("cookie") ?? "");
  const candidates = Object.entries(cookies)
    .filter(([name, value]) => name.startsWith(GUEST_COOKIE_PREFIX) && value)
    .map(([name, value]) => ({ sessionId: name.slice(GUEST_COOKIE_PREFIX.length), token: value as string }))
    .filter((candidate) => SESSION_ID_PATTERN.test(candidate.sessionId) && candidate.token.length <= MAX_GUEST_TOKEN_LENGTH)
    .slice(0, MAX_GUEST_COOKIE_CANDIDATES);
  if (!candidates.length) return false;

  const sessions = await prisma.quizSession.findMany({
    where: { quizId, id: { in: candidates.map((candidate) => candidate.sessionId) } },
    select: { id: true },
  });
  if (!sessions.length) return false;

  const bySession = new Map(candidates.map((candidate) => [candidate.sessionId, candidate.token]));
  const guest = await prisma.sessionParticipant.findFirst({
    where: {
      userId: null,
      status: { not: "KICKED" },
      OR: sessions.map((session) => ({
        sessionId: session.id,
        guestTokenHash: hashGuestToken(bySession.get(session.id)!),
      })),
    },
    select: { id: true },
  });
  return Boolean(guest);
}
