import type { LibraryView } from "@/lib/quiz/library-page";

export const QUIZ_LIBRARY_PATHS: Record<LibraryView, string> = {
  ALL: "/quiz",
  FAVORITES: "/quiz/favorites",
  ASSIGNED: "/quiz/assigned",
  UNASSIGNED: "/quiz/unassigned",
  DRAFT: "/quiz/drafts",
};

export function legacyQuizLibraryView(value: string | null | undefined): LibraryView | null {
  return value && Object.prototype.hasOwnProperty.call(QUIZ_LIBRARY_PATHS, value)
    ? value as LibraryView
    : null;
}
