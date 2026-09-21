import { renderFormListPage, type FormListSearchParams } from "@/app/(workspace)/forms/(library)/form-list-page";

export default function DraftFormsPage({ searchParams }: { searchParams: FormListSearchParams }) {
  return renderFormListPage(searchParams, "DRAFT");
}
