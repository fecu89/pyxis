import { renderQuizLibraryPage, type QuizLibrarySearchParams } from "@/app/(workspace)/quiz/(library)/quiz-library-page";

export default function QuizDiscoverPage({ searchParams }: { searchParams: QuizLibrarySearchParams }) {
  return renderQuizLibraryPage(searchParams, { tab: "discover", view: "ALL" });
}
