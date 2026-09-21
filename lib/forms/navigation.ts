export const FORM_LIST_VIEWS = ["ALL", "OPEN", "DRAFT", "CLOSED"] as const;
export type FormListView = (typeof FORM_LIST_VIEWS)[number];

export const FORM_LIST_PATHS: Record<FormListView, string> = {
  ALL: "/forms",
  OPEN: "/forms/open",
  DRAFT: "/forms/drafts",
  CLOSED: "/forms/closed",
};

export function legacyFormListView(value: string | null | undefined): FormListView | null {
  return value && (FORM_LIST_VIEWS as readonly string[]).includes(value)
    ? value as FormListView
    : null;
}
