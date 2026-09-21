import { redirect } from "next/navigation";
import { HostSession } from "@/components/quiz/host-session";
import { requireActiveUser } from "@/lib/auth/authorization";
import { getPublicQuizLiveAudioSettings } from "@/lib/quiz/live-audio";
import { loadAuthenticatedQuizSessionData } from "@/lib/quiz/session-data";

export const dynamic = "force-dynamic";

export default async function HostSessionPage({ params }: { params: Promise<{ sessionId: string }> }) {
  const { sessionId } = await params;
  const actor = await requireActiveUser();
  const [data, audioSettings] = await Promise.all([
    loadAuthenticatedQuizSessionData(sessionId, actor),
    getPublicQuizLiveAudioSettings(),
  ]);
  if (data.participant) redirect(`/p/${sessionId}`);
  return <HostSession sessionId={sessionId} initialSnapshot={{ session: data.session, participants: data.participants }} audioSettings={audioSettings} />;
}
