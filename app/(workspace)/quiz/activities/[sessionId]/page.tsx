import { redirect } from "next/navigation";
import { redirectToLogin } from "@/lib/auth/page-guard";
import { AsyncSessionManager } from "@/components/quiz/async-session-manager";
import { BackLink, PageHeader, PageShell } from "@/components/ui/page-layout";
import { getCurrentUser } from "@/lib/auth/current-user";
import { requireSessionAccess } from "@/lib/quiz/access";
import { getPrisma } from "@/lib/prisma";

export default async function SessionManagePage({ params }: { params: Promise<{ sessionId: string }> }) {
  const { sessionId } = await params;
  const actor = await getCurrentUser();
  if (!actor) redirectToLogin(`/quiz/activities/${sessionId}`);
  const { session, participant } = await requireSessionAccess(sessionId, actor);
  if (participant) redirect(session.status === "FINISHED" ? `/quiz/activities/${sessionId}/report` : `/p/${sessionId}`);
  if (session.mode === "LIVE") redirect(session.status === "FINISHED" ? `/quiz/activities/${sessionId}/report` : `/quiz/host/${sessionId}`);
  if (session.status === "FINISHED") redirect(`/quiz/activities/${sessionId}/report`);

  const [quiz, participants] = await Promise.all([
    getPrisma().quiz.findUnique({ where: { id: session.quizId }, select: { title: true, _count: { select: { questions: true } } } }),
    getPrisma().sessionParticipant.findMany({ where: { sessionId }, orderBy: { joinedAt: "asc" }, select: { id: true, nickname: true, score: true, status: true, currentQuestionIndex: true, joinedAt: true } }),
  ]);
  if (!quiz) redirect("/quiz/activities");

  return <PageShell><BackLink href="/quiz/activities">결과 목록</BackLink><PageHeader eyebrow="Self-paced session" title={quiz.title} description="참여 링크와 QR을 공유하고 학생별 진행 상태를 확인하세요." /><AsyncSessionManager initial={{ id: session.id, status: session.status, pinCode: session.pinCode, openAt: session.openAt?.toISOString() ?? null, dueAt: session.dueAt?.toISOString() ?? null, allowLateSubmission: session.allowLateSubmission, requiresLogin: session.requiresLogin, totalQuestions: quiz._count.questions, participantCount: participants.length, participants: participants.map((participant) => ({ ...participant, joinedAt: participant.joinedAt.toISOString() })) }} /></PageShell>;
}
