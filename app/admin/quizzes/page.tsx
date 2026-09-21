import { QuizManager } from "@/components/admin/resources/quiz-manager";
import { getAdminSectionContext } from "@/lib/admin/access";
import { getAdminQuizPage } from "@/lib/quiz/admin-queries";

export default async function AdminQuizzesPage() {
  const context = await getAdminSectionContext("quizzes");
  if (!context) return null;
  const result = await getAdminQuizPage({ page: 1, pageSize: 25, includeArchived: false });
  return <QuizManager initialQuizzes={result.quizzes} initialTotalCount={result.totalCount} initialPage={result.page} initialPageSize={result.pageSize} />;
}
