import Link from "next/link";
import { redirect } from "next/navigation";
import { redirectToLogin } from "@/lib/auth/page-guard";
import { QuizIcon, SessionIcon } from "@/components/ui/icons";
import { SessionResultsList, type SessionResultItem } from "@/components/quiz/session-results-list";
import { EmptyState } from "@/components/ui/feedback";
import { PageHeader, PageShell } from "@/components/ui/page-layout";
import { PageNumberNavigation } from "@/components/ui/page-number-navigation";
import { href } from "@/lib/routes";
import { canManageAnySession } from "@/lib/auth/authorization";
import { getCurrentUser } from "@/lib/auth/current-user";
import { getPrisma } from "@/lib/prisma";

/**
 * 교사가 연 세션의 참여·응답 결과.
 *
 * 사이드바에는 교사·관리자에게만 보입니다(`lib/routes.ts`의 `roles`). 그래도 주소를 직접 열거나
 * 옛 링크를 타고 오는 학생이 있으므로, 조용히 `/j`로 되돌리지 않고 왜 볼 수 없는지와 어디로
 * 가면 되는지를 보여 줍니다 — `/quiz/assignments`가 비학생에게 하는 것과 같은 처리입니다.
 */
const SESSION_PAGE_SIZE = 30;

export default async function SessionsPage({ searchParams }: { searchParams: Promise<{ page?: string }> }) {
  const user = await getCurrentUser();
  if (!user) redirectToLogin("/quiz/activities");
  if (user.role === "STUDENT") {
    return (
      <PageShell size="medium">
        <PageHeader eyebrow="Quiz results" title="결과 보기" description="선생님이 연 퀴즈 세션의 참여 결과를 모아 보는 화면입니다." />
        <EmptyState
          icon={<SessionIcon className="h-6 w-6" />}
          title="선생님 계정에서만 볼 수 있어요"
          description="받은 과제는 '할당 퀴즈'에서, 내가 응시한 기록은 리포트에서 볼 수 있습니다."
          action={<Link href={href("quizAssignments")} className="button primary">할당 퀴즈로 가기</Link>}
        />
      </PageShell>
    );
  }
  const requestedPage = Number.parseInt((await searchParams).page ?? "1", 10);
  const page = Number.isSafeInteger(requestedPage) && requestedPage > 0 ? requestedPage : 1;
  const where = canManageAnySession(user) ? {} : { hostId: user.id };
  const [sessions, total] = await Promise.all([
    getPrisma().quizSession.findMany({ where, orderBy: { createdAt: "desc" }, skip: (page - 1) * SESSION_PAGE_SIZE, take: SESSION_PAGE_SIZE, select: { id: true, mode: true, status: true, pinCode: true, requiresLogin: true, createdAt: true, quiz: { select: { title: true } }, _count: { select: { participants: true, answers: true } } } }),
    getPrisma().quizSession.count({ where }),
  ]);
  const totalPages = Math.max(1, Math.ceil(total / SESSION_PAGE_SIZE));
  if (page > totalPages) redirect(totalPages > 1 ? `/quiz/activities?page=${totalPages}` : "/quiz/activities");

  const items: SessionResultItem[] = sessions.map((session) => ({
    id: session.id,
    mode: session.mode,
    status: session.status,
    pinCode: session.pinCode,
    requiresLogin: session.requiresLogin,
    createdAt: session.createdAt.toISOString(),
    quizTitle: session.quiz.title,
    participantCount: session._count.participants,
    answerCount: session._count.answers,
  }));

  return <PageShell><PageHeader eyebrow="Quiz results" title="결과 보기" description="진행 중인 활동과 완료된 퀴즈의 참여·응답 결과를 확인하세요." action={<Link href="/quiz" className="inline-flex min-h-11 items-center gap-2 rounded-xl bg-brand-strong px-5 py-3 text-sm font-black text-on-brand"><QuizIcon className="h-4 w-4" />퀴즈에서 세션 열기</Link>} />
    {items.length > 0 ? <><SessionResultsList key={page} sessions={items} /><PageNumberNavigation basePath="/quiz/activities" page={page} totalPages={totalPages} /></> : <EmptyState icon={<SessionIcon className="h-6 w-6" />} title="아직 확인할 결과가 없어요" description="퀴즈 보관함에서 발행된 퀴즈의 세션을 열면 참여 결과가 이곳에 쌓입니다." action={<Link href="/quiz" className="inline-flex rounded-xl bg-brand-strong px-5 py-3 text-sm font-black text-on-brand">퀴즈 보관함으로</Link>} />}
  </PageShell>;
}
