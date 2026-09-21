import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { BackLink, PageHeader, PageShell } from "@/components/ui/page-layout";
import { SelfSessionReportView } from "@/components/quiz/self-session-report";
import { findGuestParticipant, guestCookieName } from "@/lib/quiz/guest-access";
import { buildParticipantSessionReport } from "@/lib/quiz/report";
import { getPrisma } from "@/lib/prisma";

export default async function PublicSessionReportPage({ params }: { params: Promise<{ sessionId: string }> }) {
  const { sessionId } = await params;
  const session = await getPrisma().quizSession.findUnique({ where: { id: sessionId }, select: { pinCode: true, requiresLogin: true } });
  if (!session || session.requiresLogin) redirect("/j");
  const cookieStore = await cookies();
  const participant = await findGuestParticipant(sessionId, cookieStore.get(guestCookieName(sessionId))?.value ?? null);
  if (!participant) redirect(session.pinCode ? `/j/${session.pinCode}` : "/j");
  const report = await buildParticipantSessionReport(sessionId, participant.id);
  return <PageShell size="medium"><BackLink href="/j">다른 퀴즈 참여</BackLink><PageHeader eyebrow="Public quiz result" title={report.quizTitle} description="이 결과는 현재 브라우저에서만 다시 볼 수 있으며 학생 계정 기록에는 연결되지 않습니다." /><SelfSessionReportView report={report} returnHref="/j" publicAccess /></PageShell>;
}
