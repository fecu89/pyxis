import { QuizLiveAudioSettingsPanel } from "@/components/admin/quiz-live-audio-settings";
import { getAdminSectionContext } from "@/lib/admin/access";
import { getPublicQuizLiveAudioSettings } from "@/lib/quiz/live-audio";

export default async function AdminAudioPage() {
  const context = await getAdminSectionContext("audio");
  if (!context) return null;
  return <QuizLiveAudioSettingsPanel initialSettings={await getPublicQuizLiveAudioSettings()} />;
}
