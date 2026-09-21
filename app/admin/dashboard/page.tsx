import { AdminDashboardRoutePanel } from "@/components/admin/admin-dashboard-route-panel";
import { getAdminSectionContext } from "@/lib/admin/access";
import { getSchoolDirectory } from "@/lib/users/organization";

export default async function AdminDashboardPage() {
  const context = await getAdminSectionContext("dashboard");
  if (!context) return null;
  const allSchools = await getSchoolDirectory();
  const schools = context.scopedSchoolId ? allSchools.filter(({ id }) => id === context.scopedSchoolId) : allSchools;
  return <AdminDashboardRoutePanel schools={schools} canEditSchoolProfile={context.user.role === "SUPER_ADMIN"} canManageRoster={context.access.canManageRoster} />;
}
