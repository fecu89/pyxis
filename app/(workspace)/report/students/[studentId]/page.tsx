import { redirect } from "next/navigation";
import { HistoryView } from "@/components/quiz/history-view";
import { StudentFormHistory } from "@/components/report/student-form-history";
import { StudentPadHistory } from "@/components/report/student-pad-history";
import { BackLink, PageHeader, PageShell } from "@/components/ui/page-layout";
import { getCurrentUser } from "@/lib/auth/current-user";
import { canViewStudentReport } from "@/lib/auth/authorization";
import { getStudentFormResponseHistory, getStudentPadPostHistory } from "@/lib/activity/students";
import { redirectToLogin } from "@/lib/auth/page-guard";
import { getPrisma } from "@/lib/prisma";
import { getStudentQuizHistory } from "@/lib/quiz/history";
import { href } from "@/lib/routes";
import { decryptUserLoginIdentifier, toPublicAuthorDTO } from "@/lib/users/repository";

/**
 * 한 학생의 활동 기록. 목록은 `/report/students`입니다.
 *
 * 판정에 `canManageStudent`가 아니라 `canViewStudentReport`를 쓰는 이유: 전자는 계정 발급·비밀번호
 * 재설정 권한이라 대표교사만 통과합니다. 자기 반 학생의 활동을 보려고 계정 발급 권한을 받아야 하는
 * 건 말이 안 되므로, 리포트는 목록과 같은 범위(같은 학교 교사면 가능)로 판정합니다.
 */
export default async function StudentReportPage({ params }: { params: Promise<{ studentId: string }> }) {
  const { studentId } = await params;
  const actor = await getCurrentUser();
  if (!actor) redirectToLogin(href("reportStudent", { studentId }));

  const student = await getPrisma().user.findUnique({
    where: { id: studentId },
    select: {
      id: true, role: true, status: true, registrationApprovalStatus: true, schoolId: true,
      nameEncrypted: true, imageEncrypted: true, loginIdentifierEncrypted: true,
      schoolGroup: { select: { name: true } },
    },
  });
  if (!student || student.role !== "STUDENT" || student.status !== "ACTIVE" || student.registrationApprovalStatus !== "APPROVED" || !canViewStudentReport(actor, student)) {
    redirect(href("reportStudents"));
  }

  const [history, padPosts, formResponses] = await Promise.all([
    getStudentQuizHistory(studentId),
    getStudentPadPostHistory(studentId),
    getStudentFormResponseHistory(studentId),
  ]);
  const name = toPublicAuthorDTO(student).name ?? decryptUserLoginIdentifier(student) ?? "학생";

  return (
    <PageShell size="medium">
      <BackLink href={href("reportStudents")}>학생 목록</BackLink>
      <PageHeader
        eyebrow={student.schoolGroup?.name ?? "Student history"}
        title={`${name}님의 기록`}
        description="작성한 패드 글, 제출한 설문 응답, 퀴즈별 점수와 제출 답안을 함께 확인하세요."
      />
      <div className="space-y-10">
        <StudentPadHistory posts={padPosts} />
        <StudentFormHistory responses={formResponses} />
        <section aria-labelledby="student-quiz-history-title">
          <div className="mb-4">
            <p className="text-[11px] font-black uppercase tracking-[0.18em] text-brand">Quiz attempts</p>
            <h2 id="student-quiz-history-title" className="mt-1 text-xl font-black tracking-tight text-content">퀴즈 응시 기록</h2>
          </div>
          <HistoryView history={history} />
        </section>
      </div>
    </PageShell>
  );
}
