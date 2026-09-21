import { redirectToLogin } from "@/lib/auth/page-guard";
import { HistoryView } from "@/components/quiz/history-view";
import { StudentFormHistory } from "@/components/report/student-form-history";
import { StudentPadHistory } from "@/components/report/student-pad-history";
import { BackLink, PageHeader, PageShell } from "@/components/ui/page-layout";
import { getCurrentUser } from "@/lib/auth/current-user";
import { getStudentFormResponseHistory, getStudentPadPostHistory } from "@/lib/activity/students";
import { getStudentQuizHistory } from "@/lib/quiz/history";

export default async function MyHistoryPage() {
  const user = await getCurrentUser();
  if (!user) redirectToLogin("/report/students/me");
  const [history, padPosts, formResponses] = await Promise.all([
    getStudentQuizHistory(user.id),
    getStudentPadPostHistory(user.id),
    getStudentFormResponseHistory(user.id),
  ]);
  return (
    <PageShell size="medium">
      <BackLink href="/j">참여 화면</BackLink>
      <PageHeader eyebrow="My learning" title="내 학습 기록" description="작성한 패드 글, 제출한 설문 응답, 참여한 퀴즈 결과를 한곳에서 확인해 보세요." />
      <div className="space-y-10">
        <StudentPadHistory posts={padPosts} />
        <StudentFormHistory responses={formResponses} />
        <section aria-labelledby="my-quiz-history-title">
          <div className="mb-4">
            <p className="text-[11px] font-black uppercase tracking-[0.18em] text-brand">Quiz attempts</p>
            <h2 id="my-quiz-history-title" className="mt-1 text-xl font-black tracking-tight text-content">퀴즈 응시 기록</h2>
          </div>
          <HistoryView history={history} />
        </section>
      </div>
    </PageShell>
  );
}
