import { redirectToLogin } from "@/lib/auth/page-guard";
import { BackLink, PageHeader, PageShell } from "@/components/ui/page-layout";
import { HostSessionReportView } from "@/components/quiz/host-session-report";
import { SelfSessionReportView } from "@/components/quiz/self-session-report";
import { getCurrentUser } from "@/lib/auth/current-user";
import { buildSessionReport } from "@/lib/quiz/report";

export default async function SessionReportPage({ params }: { params: Promise<{ sessionId: string }> }) {
  const { sessionId } = await params;
  const actor = await getCurrentUser();
  if (!actor) redirectToLogin(`/quiz/activities/${sessionId}/report`);
  const report = await buildSessionReport(sessionId, actor);
  const self = report.scope === "SELF";
  return (
    <PageShell size={self ? "medium" : "wide"}>
      <BackLink href={self ? "/report/students/me" : "/quiz/activities"}>{self ? "내 응시 기록" : "결과 목록"}</BackLink>
      <PageHeader eyebrow="Quiz result" title={report.quizTitle} description={self ? "내가 제출한 답과 정답, 획득 점수와 응답 시간을 문항별로 확인하세요." : "참여자별 성취도와 문항별 오답 경향을 함께 살펴보세요."} />
      {self ? <SelfSessionReportView report={report} returnHref="/report/students/me" /> : <HostSessionReportView report={report} />}
    </PageShell>
  );
}
