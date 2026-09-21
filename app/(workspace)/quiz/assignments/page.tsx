import Link from "next/link";
import { redirect } from "next/navigation";
import { redirectToLogin } from "@/lib/auth/page-guard";
import { ClockIcon, QuizIcon } from "@/components/ui/icons";
import { StatusBadge } from "@/components/ui/data-display";
import { EmptyState } from "@/components/ui/feedback";
import { PageHeader, PageShell } from "@/components/ui/page-layout";
import { PageNumberNavigation } from "@/components/ui/page-number-navigation";
import { getCurrentUser } from "@/lib/auth/current-user";
import { formatDate } from "@/lib/format";
import { getPrisma } from "@/lib/prisma";
import { href } from "@/lib/routes";
// quiz의 학생 실명(displayNameEncrypted)은 병합 스키마에 없습니다. pad는 공개 표시 이름을
// nameEncrypted 하나로 다룹니다.
import { toPublicAuthorDTO } from "@/lib/users/repository";

/**
 * 학생이 할당받은 퀴즈 목록.
 *
 * 사이드바에는 학생에게만 보입니다(`lib/routes.ts`의 `roles: ["STUDENT"]`). 그래도 주소를
 * 직접 열거나 옛 링크를 타고 오는 비학생이 있으므로, 조용히 `/quiz`로 되돌리지 않고 왜 볼 수
 * 없는지와 어디로 가면 되는지를 보여 줍니다 — 리다이렉트만 하면 "눌렀는데 딴 데로 간다"로
 * 읽히고 실제로 그 신고가 들어왔습니다.
 */
const ASSIGNMENT_PAGE_SIZE = 30;

export default async function AssignmentsPage({ searchParams }: { searchParams: Promise<{ page?: string }> }) {
  const user = await getCurrentUser();
  if (!user) redirectToLogin("/quiz/assignments");
  if (user.role !== "STUDENT") {
    return (
      <PageShell size="medium">
        <PageHeader eyebrow="Assignments" title="할당된 퀴즈" description="학생이 받은 과제를 모아 보는 화면입니다." />
        <EmptyState
          icon={<QuizIcon className="h-6 w-6" />}
          title="학생 계정에서만 볼 수 있어요"
          description="이 화면은 학생이 받은 과제를 보여 줍니다. 선생님이 낸 할당 퀴즈의 진행 상황은 '진행·기록'에서 확인하세요."
          action={<Link href={href("quizActivities")} className="button primary">진행·기록으로 가기</Link>}
        />
      </PageShell>
    );
  }

  const requestedPage = Number.parseInt((await searchParams).page ?? "1", 10);
  const page = Number.isSafeInteger(requestedPage) && requestedPage > 0 ? requestedPage : 1;
  const where = { studentId: user.id, quiz: { deletedAt: null } };
  const [assignments, total] = await Promise.all([
    getPrisma().quizAssignment.findMany({
      where,
      orderBy: { createdAt: "desc" },
      skip: (page - 1) * ASSIGNMENT_PAGE_SIZE,
      take: ASSIGNMENT_PAGE_SIZE,
      select: {
      id: true,
      createdAt: true,
      quiz: { select: { id: true, title: true, description: true, subject: { select: { name: true } }, _count: { select: { questions: true } } } },
      session: { select: { id: true, status: true, participants: { where: { userId: user.id }, select: { status: true, currentQuestionIndex: true } } } },
      assignedBy: { select: { id: true, nameEncrypted: true, imageEncrypted: true } },
      },
    }),
    getPrisma().quizAssignment.count({ where }),
  ]);
  const totalPages = Math.max(1, Math.ceil(total / ASSIGNMENT_PAGE_SIZE));
  if (page > totalPages) redirect(totalPages > 1 ? `/quiz/assignments?page=${totalPages}` : "/quiz/assignments");

  return (
    <PageShell>
      <PageHeader eyebrow="Assignments" title="할당된 퀴즈" description="선생님이 보내준 퀴즈를 이어서 풀고 완료한 결과를 확인하세요." />
      {assignments.length ? <><div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">{assignments.map((assignment) => {
        const participant = assignment.session.participants[0];
        const completed = participant?.status === "COMPLETED";
        const started = participant?.status === "IN_PROGRESS" || (participant?.currentQuestionIndex ?? 0) > 0;
        const teacherName = toPublicAuthorDTO(assignment.assignedBy).name || "선생님";
        return <article key={assignment.id} className="flex min-h-64 flex-col rounded-[26px] border border-line bg-surface p-6 shadow-sm"><div className="flex items-start justify-between gap-3"><span className="grid h-11 w-11 place-items-center rounded-2xl bg-info-100 text-info-800 dark:bg-info-400/15 dark:text-info-300"><QuizIcon className="h-5 w-5" /></span><StatusBadge status={completed ? "COMPLETED" : started ? "IN_PROGRESS" : "JOINED"} label={completed ? "완료" : started ? "진행 중" : "새 과제"} /></div><div className="mt-5"><p className="text-[11px] font-black text-brand">{assignment.quiz.subject?.name || "미분류"}</p><h2 className="mt-1 text-xl font-black tracking-tight text-content">{assignment.quiz.title}</h2><p className="mt-2 line-clamp-2 text-sm leading-6 text-content-muted">{assignment.quiz.description || `${teacherName}님이 할당한 퀴즈입니다.`}</p></div><div className="mt-auto pt-5"><div className="mb-3 flex items-center gap-3 text-[11px] font-bold text-content-subtle"><span>문항 {assignment.quiz._count.questions}개</span><span className="inline-flex items-center gap-1"><ClockIcon className="h-3.5 w-3.5" />{formatDate(assignment.createdAt)}</span></div><Link href={completed ? `/quiz/activities/${assignment.session.id}/report` : `/p/${assignment.session.id}`} className="flex min-h-12 w-full items-center justify-center rounded-2xl bg-brand-strong px-5 text-sm font-black text-on-brand transition hover:bg-brand-900 dark:hover:bg-brand-800">{completed ? "결과 보기" : started ? "이어서 풀기" : "퀴즈 시작"}</Link></div></article>;
      })}</div><PageNumberNavigation basePath="/quiz/assignments" page={page} totalPages={totalPages} /></> : <EmptyState icon={<QuizIcon className="h-6 w-6" />} title="아직 할당된 퀴즈가 없어요" description="선생님이 퀴즈를 할당하면 알림과 함께 이곳에 표시됩니다." />}
    </PageShell>
  );
}
