import { FormManager } from "@/components/admin/resources/form-manager";
import { getAdminSectionContext } from "@/lib/admin/access";
import { getAdminFormPage } from "@/lib/forms/admin-queries";

export default async function AdminFormsPage() {
  const context = await getAdminSectionContext("forms");
  if (!context) return null;
  const result = await getAdminFormPage({ page: 1, pageSize: 25, includeArchived: false });
  return <FormManager initialForms={result.forms} initialTotalCount={result.totalCount} initialPage={result.page} initialPageSize={result.pageSize} />;
}
