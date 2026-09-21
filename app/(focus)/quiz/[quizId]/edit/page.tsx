import { QuizEditor } from "@/components/quiz/quiz-editor";
import { redirect } from "next/navigation";
import { after } from "next/server";
import { requireActiveUser } from "@/lib/auth/authorization";
import { requireViewableQuiz } from "@/lib/quiz/access";
import { loadQuizEditorData } from "@/lib/quiz/editor-data";
import { getUploadPolicy } from "@/lib/files/upload-policy";
import { recordQuizVisit } from "@/lib/dashboard/visits";

export default async function EditQuizPage({ params }: { params: Promise<{ quizId: string }> }) {
  const { quizId } = await params;
  const actor = await requireActiveUser();
  const access = await requireViewableQuiz(quizId, actor);
  if (access.level === "VIEWER") redirect(`/quiz/${quizId}`);
  after(() => recordQuizVisit(quizId, actor.id));
  const accessLevel = access.level === "OWNER" ? "OWNER" : "EDITOR";
  const [quiz, uploadPolicy] = await Promise.all([
    loadQuizEditorData(quizId, access.quiz.ownerId, accessLevel),
    getUploadPolicy(),
  ]);
  if (!quiz) redirect("/quiz");
  return <QuizEditor quizId={quizId} initialQuiz={{ ...quiz, accessLevel }} uploadPolicy={uploadPolicy} />;
}
