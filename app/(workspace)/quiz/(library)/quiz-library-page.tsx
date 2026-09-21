import { redirect } from "next/navigation";
import { QuizLibrary } from "@/components/quiz/quiz-library";
import { getCurrentUser } from "@/lib/auth/current-user";
import { redirectToLogin } from "@/lib/auth/page-guard";
import { currentQuizLimit } from "@/lib/quiz/creation-limit";
import { getQuizLibraryPage, parseLibraryParams, type LibraryParams, type LibraryView } from "@/lib/quiz/library-page";
import { QUIZ_LIBRARY_PATHS } from "@/lib/quiz/library-navigation";

export type QuizLibrarySearchParams = Promise<Record<string, string | string[] | undefined>>;

export async function renderQuizLibraryPage(
  searchParams: QuizLibrarySearchParams,
  options: { tab: LibraryParams["tab"]; view: LibraryView },
) {
  const path = options.tab === "discover" ? "/quiz/discover" : QUIZ_LIBRARY_PATHS[options.view];
  const user = await getCurrentUser();
  if (!user) redirectToLogin(path);
  if (options.tab === "discover" && user.role === "STUDENT") redirect("/quiz");

  const params = parseLibraryParams(await searchParams, options.tab, options.view);
  const [data, quizLimit] = await Promise.all([getQuizLibraryPage(user, params), currentQuizLimit(user.role)]);
  return <QuizLibrary
    viewer={{ id: user.id, role: user.role, name: user.name || user.loginId || "사용자", classLabel: user.schoolGroup?.name ?? null }}
    canCreate={quizLimit === null || data.ownedCount < quizLimit}
    creationLimit={quizLimit === null ? null : { used: data.ownedCount, max: quizLimit }}
    quizzes={data.items}
    total={data.total}
    pageSize={data.pageSize}
    viewCounts={data.viewCounts}
    sidebarSubjects={data.sidebarSubjects}
    unclassifiedCount={data.unclassifiedCount}
    ownerFilter={data.ownerFilter}
    params={params}
  />;
}
