import Link from "next/link";
import { cookies } from "next/headers";
import { notFound } from "next/navigation";
import { GlobeIcon, LockIcon } from "@/components/ui/icons";
import { JoinSessionCard } from "@/components/quiz/join-session-card";
import { getCurrentUser } from "@/lib/auth/current-user";
import { findGuestParticipant, guestCookieName } from "@/lib/quiz/guest-access";
import { getPrisma } from "@/lib/prisma";
import { loginRedirectPath, redirectToLogin } from "@/lib/auth/page-guard";
import { assertCourseLiveAccess } from "@/lib/quiz/course-participation";
import { AuthorizationError } from "@/lib/auth/authorization";
import { href } from "@/lib/routes";
import { buildJoinPageMetadata } from "@/utils/seo/sessionShare";

export async function generateMetadata({ params }: { params: Promise<{ pin: string }> }) {
  const { pin } = await params;
  return buildJoinPageMetadata(pin);
}

/**
 * PIN 참여 화면. 로그인이 필요한 세션과 공개 세션을 한 라우트가 모두 처리합니다.
 *
 * 예전에는 `/join/[pin]`과 `/public/join/[pin]`으로 갈려 있었는데, 두 페이지가 각각
 * `session.requiresLogin`을 보고 서로에게 리다이렉트해서 정상 참여에도 왕복이 한 번씩
 * 끼었습니다. 어느 쪽이 맞는지는 세션을 조회해야 알 수 있고 조회는 어차피 두 페이지가
 * 똑같이 하고 있었으므로, 한 번 조회하고 그 자리에서 분기하는 게 맞습니다.
 */
export default async function JoinWithPinPage({ params, searchParams }: { params: Promise<{ pin: string }>; searchParams: Promise<{ subjectId?: string | string[] }> }) {
  const { pin } = await params;
  const { subjectId } = await searchParams;
  if (!/^\d{6}$/.test(pin)) notFound();
  if (subjectId !== undefined && (typeof subjectId !== "string" || !subjectId || subjectId.length > 100)) notFound();

  const [user, session] = await Promise.all([
    getCurrentUser(),
    getPrisma().quizSession.findUnique({
      where: { pinCode: pin },
      select: { id: true, mode: true, status: true, hostId: true, requiresLogin: true, quiz: { select: { title: true, subjectId: true, isPublished: true, deletedAt: true } } },
    }),
  ]);

  if (!session || session.status === "FINISHED" || session.status === "CANCELLED") {
    return (
      <JoinMessage
        title="참여할 수 없는 링크예요"
        description="PIN이 올바르지 않거나 이미 종료된 세션입니다."
      />
    );
  }

  if (subjectId) {
    if (!user) redirectToLogin(`/j/${pin}?subjectId=${encodeURIComponent(subjectId)}`);
    try { await assertCourseLiveAccess(session, subjectId, user); }
    catch (error) { if (error instanceof AuthorizationError) notFound(); throw error; }
  }

  // 공개 세션 — 게스트 쿠키로 이전 참여를 이어받고, 없으면 닉네임부터 받습니다.
  if (!session.requiresLogin) {
    const cookieStore = await cookies();
    const guest = await findGuestParticipant(session.id, cookieStore.get(guestCookieName(session.id))?.value ?? null);
    return (
      <main className="surface-grid grid flex-1 place-items-center px-4 py-12">
        <JoinSessionCard
          pin={pin}
          quizTitle={session.quiz.title}
          mode={session.mode}
          requiresLogin={false}
          initialNickname={guest?.nickname ?? ""}
          canJoin={guest?.status !== "KICKED"}
          resume={Boolean(guest)}
          publicAccess
          subjectId={subjectId}
        />
      </main>
    );
  }

  // 로그인 세션인데 학생이 아니면(비로그인 포함) 로그인부터. 돌아올 곳은 이 주소입니다.
  if (user?.role !== "STUDENT") {
    return (
      <main className="surface-grid grid flex-1 place-items-center px-4 py-12">
        <section className="w-full max-w-lg rounded-[34px] border border-line bg-surface p-7 text-center shadow-xl sm:p-9"><div className="mx-auto grid h-14 w-14 place-items-center rounded-2xl bg-brand-soft text-brand-soft-fg"><LockIcon className="h-7 w-7" /></div><p className="mt-6 text-xs font-black uppercase tracking-[0.18em] text-brand">Login required</p><h1 className="mt-3 text-3xl font-black tracking-tight text-content">{session.quiz.title}</h1><p className="mt-3 text-sm leading-6 text-content-muted">이 퀴즈는 개인별 학습 기록을 남기기 위해 학생 로그인이 필요합니다. 로그인하면 이 참여 링크로 자동 복귀합니다.</p><Link href={loginRedirectPath(href("joinWithPin", { pin }))} className="mt-7 inline-flex min-h-13 items-center rounded-2xl bg-brand-strong px-6 py-3 text-sm font-black text-on-brand">학생 로그인하고 계속하기</Link><Link href={href("joinEntry")} className="mt-4 block text-xs font-black text-content-subtle">다른 PIN 입력</Link></section>
      </main>
    );
  }

  const participant = await getPrisma().sessionParticipant.findUnique({
    where: { sessionId_userId: { sessionId: session.id, userId: user.id } },
  });

  return (
    <main className="surface-grid grid flex-1 place-items-center px-4 py-12">
      <JoinSessionCard
        pin={pin}
        quizTitle={session.quiz.title}
        mode={session.mode}
        requiresLogin
        initialNickname={participant?.nickname ?? (user.name || user.loginId || "")}
        canJoin={participant?.status !== "KICKED"}
        resume={Boolean(participant)}
        autoJoin
        subjectId={subjectId}
      />
    </main>
  );
}

function JoinMessage({ title, description }: { title: string; description: string }) {
  return <main className="surface-grid grid flex-1 place-items-center px-4 py-12"><section className="w-full max-w-lg rounded-[34px] border border-line bg-surface p-8 text-center"><div className="mx-auto grid h-14 w-14 place-items-center rounded-2xl bg-info-100 text-info-800 dark:bg-info-400/15 dark:text-info-300"><GlobeIcon className="h-7 w-7" /></div><h1 className="mt-6 text-2xl font-black text-content">{title}</h1><p className="mt-3 text-sm text-content-muted">{description}</p><Link href={href("joinEntry")} className="mt-7 inline-flex rounded-xl bg-brand-strong px-5 py-3 text-sm font-black text-on-brand">PIN 다시 입력</Link></section></main>;
}
