import { renderFormListPage, type FormListSearchParams } from "@/app/(workspace)/forms/(library)/form-list-page";

export default function OpenFormsPage({ searchParams }: { searchParams: FormListSearchParams }) {
  return renderFormListPage(searchParams, "OPEN");
}
