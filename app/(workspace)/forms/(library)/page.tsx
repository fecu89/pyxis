import { redirect } from "next/navigation";
import { renderFormListPage, type FormListSearchParams } from "@/app/(workspace)/forms/(library)/form-list-page";
import { FORM_LIST_PATHS, legacyFormListView } from "@/lib/forms/navigation";

export default async function FormsPage({ searchParams }: { searchParams: FormListSearchParams }) {
  const raw = await searchParams;
  const rawView = Array.isArray(raw.view) ? raw.view[0] : raw.view;
  const legacyView = legacyFormListView(rawView);
  if (legacyView && legacyView !== "ALL") {
    const page = Array.isArray(raw.page) ? raw.page[0] : raw.page;
    redirect(page ? `${FORM_LIST_PATHS[legacyView]}?page=${encodeURIComponent(page)}` : FORM_LIST_PATHS[legacyView]);
  }
  return renderFormListPage(Promise.resolve(raw), "ALL");
}
