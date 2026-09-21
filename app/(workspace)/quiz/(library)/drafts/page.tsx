import { redirect } from "next/navigation";
import type { QuizLibrarySearchParams } from "@/app/(workspace)/quiz/(library)/quiz-library-page";

export default async function DraftQuizzesPage({ searchParams }: { searchParams: QuizLibrarySearchParams }) {
  const raw = await searchParams;
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(raw)) {
    if (key === "view" || key === "status" || value === undefined) continue;
    const item = Array.isArray(value) ? value[0] : value;
    if (item) query.set(key, item);
  }
  query.set("status", "DRAFT");
  redirect(`/quiz?${query}`);
}
