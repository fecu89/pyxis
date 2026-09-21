import { SchoolManager } from "@/components/admin/school-manager";
import { getAdminSectionContext } from "@/lib/admin/access";
import { getAdminSchoolPage } from "@/lib/users/organization";

export default async function AdminSchoolsPage() {
  const context = await getAdminSectionContext("schools");
  if (!context) return null;
  const result = await getAdminSchoolPage({ page: 1, pageSize: 25, schoolId: context.scopedSchoolId ?? undefined });
  return <SchoolManager initialSchools={result.schools} initialTotalCount={result.totalCount} initialPage={result.page} initialPageSize={result.pageSize} canManageSchoolLevel={context.user.role === "SUPER_ADMIN"} canManageSchoolGroups={context.access.canManageSchoolGroups} />;
}
