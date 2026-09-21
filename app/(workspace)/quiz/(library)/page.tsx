import { redirect } from "next/navigation";
import { renderQuizLibraryPage, type QuizLibrarySearchParams } from "@/app/(workspace)/quiz/(library)/quiz-library-page";
import { QUIZ_LIBRARY_PATHS, legacyQuizLibraryView } from "@/lib/quiz/library-navigation";

export default async function QuizzesPage({ searchParams }: { searchParams: QuizLibrarySearchParams }) {
  const raw = await searchParams;
  const first = (value: string | string[] | undefined) => Array.isArray(value) ? value[0] : value;
  const tab = first(raw.tab);
  const legacyView = legacyQuizLibraryView(first(raw.view));
  if (tab === "discover" || (legacyView && legacyView !== "ALL")) {
    const target = tab === "discover" ? "/quiz/discover" : QUIZ_LIBRARY_PATHS[legacyView!];
    const query = new URLSearchParams();
    for (const [key, value] of Object.entries(raw)) {
      if (key === "tab" || key === "view") continue;
      const item = first(value);
      if (item) query.set(key, item);
    }
    redirect(query.size ? `${target}?${query}` : target);
  }
  return renderQuizLibraryPage(Promise.resolve(raw), { tab: "mine", view: "ALL" });
}
