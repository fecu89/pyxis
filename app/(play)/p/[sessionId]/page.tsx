import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { PlaySession } from "@/components/quiz/play-session";
import { getCurrentUser } from "@/lib/auth/current-user";
import { redirectToLogin } from "@/lib/auth/page-guard";
import { findGuestParticipant, guestCookieName } from "@/lib/quiz/guest-access";
import { getPrisma } from "@/lib/prisma";
import { DASHBOARD_PATH, href } from "@/lib/routes";
import { buildPublicQuizSessionData, loadAuthenticatedQuizSessionData } from "@/lib/quiz/session-data";
import { getPublicQuizLiveAudioSettings } from "@/lib/quiz/live-audio";
import { QUIZ_LIVE_AUDIO_DEFAULTS } from "@/lib/quiz/live-audio-shape";

/**
 * 퀴즈 풀이 화면. `/j/[pin]`과 마찬가지로 로그인 세션과 공개 세션을 한 라우트가 처리합니다.
 * 어느 쪽인지는 세션의 `requiresLogin`이 정하고, 그건 조회해야 알 수 있습니다.
 */
export default async function PlaySessionPage({ params }: { params: Promise<{ sessionId: string }> }) {
  const { sessionId } = await params;
  const session = await getPrisma().quizSession.findUnique({
    where: { id: sessionId },
  });
  if (!session) redirect(href("joinEntry"));
  const audioSettingsPromise = session.mode === "LIVE"
    ? getPublicQuizLiveAudioSettings()
    : Promise.resolve(QUIZ_LIVE_AUDIO_DEFAULTS);

  if (!session.requiresLogin) {
    // 공개 세션은 게스트 쿠키가 참여 증명입니다. 없으면 닉네임을 받는 참여 화면으로 되돌립니다.
    const cookieStore = await cookies();
    const guest = await findGuestParticipant(sessionId, cookieStore.get(guestCookieName(sessionId))?.value ?? null);
    if (!guest) redirect(session.pinCode ? href("joinWithPin", { pin: session.pinCode }) : href("joinEntry"));
    const [data, audioSettings] = await Promise.all([
      buildPublicQuizSessionData(session, guest),
      audioSettingsPromise,
    ]);
    return <PlaySession sessionId={sessionId} initialSession={data.session} audioSettings={audioSettings} publicAccess />;
  }

  const user = await getCurrentUser();
  if (!user) redirectToLogin(href("playSession", { sessionId }));
  if (user.role !== "STUDENT") redirect(DASHBOARD_PATH);
  const [data, audioSettings] = await Promise.all([
    loadAuthenticatedQuizSessionData(sessionId, user),
    audioSettingsPromise,
  ]);
  return <PlaySession sessionId={sessionId} initialSession={data.session} audioSettings={audioSettings} />;
}
