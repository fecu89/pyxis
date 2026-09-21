import { renderFormListPage, type FormListSearchParams } from "@/app/(workspace)/forms/(library)/form-list-page";

export default function ClosedFormsPage({ searchParams }: { searchParams: FormListSearchParams }) {
  return renderFormListPage(searchParams, "CLOSED");
}
