import "server-only";

import { AuthorizationError, canHostOrControlSession, canViewAllQuizzes, hasSystemPermission } from "@/lib/auth/authorization";
import type { CurrentUser } from "@/lib/auth/current-user";
import { getPrisma } from "@/lib/prisma";

export type QuizAccessLevel = "OWNER" | "EDITOR" | "VIEWER";

export async function getQuizAccess(quizId: string, actor: CurrentUser) {
  const quiz = await getPrisma().quiz.findUnique({
    where: { id: quizId },
    include: { shares: { where: { userId: actor.id }, select: { permission: true } } },
  });
  if (!quiz || quiz.deletedAt) return null;

  // 역할이 아니라 부여된 권한으로 판정합니다. SUPER_ADMIN은 hasSystemPermission이 항상 참이라
  // 자연히 OWNER가 되고, 권한을 못 받은 ADMIN은 남의 퀴즈를 열 수 없습니다.
  // 검색 공개(isSearchable)이면서 발행된 퀴즈는 공유받지 않았어도 교사 이상이면 보기 권한을 줍니다.
  // 발행 여부까지 보는 이유: 편집 저장 시 isPublished가 false로 내려가므로, isSearchable만 보면
  // 탐색 목록에는 안 뜨는 "검색 공개된 초안"을 ID만 아는 교사가 열람·복제할 수 있습니다.
  // 탐색 목록(lib/quiz/library-page.ts)과 같은 기준(isSearchable && isPublished)으로 맞춥니다.
  // 학생은 탐색 대상이 아니므로 여전히 공유·소유로만 접근합니다.
  const searchableViewer = quiz.isSearchable && quiz.isPublished && actor.role !== "STUDENT";
  const canEditAnyQuiz = hasSystemPermission(actor, "EDIT_ANY_QUIZ");
  const level: QuizAccessLevel | null = quiz.ownerId === actor.id || canEditAnyQuiz
    ? "OWNER"
    : quiz.shares[0]?.permission ?? (canViewAllQuizzes(actor) || searchableViewer ? "VIEWER" : null);
  if (!level) return null;

  // 잠긴 퀴즈(소유자 계정 삭제)는 읽기와 복제만 남깁니다. 편집·발행·새 세션·공유·할당은 모두
  // requireManageableQuiz를 거치므로 여기서 VIEWER로 내리는 것만으로 한 번에 막힙니다.
  // EDIT_ANY_QUIZ 관리자는 예외로 두어야 나중에 정리하거나 다른 교사에게 넘길 수 있습니다.
  if (quiz.frozenAt && !canEditAnyQuiz) return { quiz, level: "VIEWER" };
  return { quiz, level };
}

export async function requireViewableQuiz(quizId: string, actor: CurrentUser) {
  const access = await getQuizAccess(quizId, actor);
  if (!access) throw new AuthorizationError("퀴즈를 찾을 수 없거나 볼 권한이 없습니다.");
  return access;
}

export async function requireManageableQuiz(quizId: string, actor: CurrentUser) {
  const access = await requireViewableQuiz(quizId, actor);
  if (access.level === "VIEWER") throw new AuthorizationError("이 퀴즈는 보기 권한만 있습니다.");
  return access.quiz;
}

export async function requireOwnedQuiz(quizId: string, actor: CurrentUser) {
  const access = await requireViewableQuiz(quizId, actor);
  if (access.level !== "OWNER") throw new AuthorizationError("퀴즈 소유자만 이 작업을 할 수 있습니다.");
  return access.quiz;
}

// 인증 세션 조회는 호스트 또는 이미 참여 등록된 로그인 학생 본인만 가능합니다.
export async function requireSessionAccess(sessionId: string, actor: CurrentUser) {
  const session = await getPrisma().quizSession.findUnique({ where: { id: sessionId } });
  if (!session) throw new AuthorizationError("세션을 찾을 수 없습니다.");

  if (canHostOrControlSession(actor, session)) return { session, participant: null };

  const participant = await getPrisma().sessionParticipant.findUnique({
    where: { sessionId_userId: { sessionId, userId: actor.id } },
  });
  if (!participant) throw new AuthorizationError();
  if (participant.status === "KICKED") throw new AuthorizationError("호스트가 이 세션에서 내보냈습니다.");
  return { session, participant };
}
