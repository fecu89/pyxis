import { renderQuizLibraryPage, type QuizLibrarySearchParams } from "@/app/(workspace)/quiz/(library)/quiz-library-page";

export default function UnassignedQuizzesPage({ searchParams }: { searchParams: QuizLibrarySearchParams }) {
  return renderQuizLibraryPage(searchParams, { tab: "mine", view: "UNASSIGNED" });
}
