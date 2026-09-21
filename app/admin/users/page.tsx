import type { UserRole, UserStatus } from "@/generated/prisma/client";
import { AdminUsersPanel, type AdminUserInitialFilters } from "@/components/admin/admin-users-panel";
import { getAdminSectionContext } from "@/lib/admin/access";
import { getAdminUserPage } from "@/lib/users/repository";
import { getSchoolDirectory } from "@/lib/users/organization";

const roles = new Set<UserRole>(["SUPER_ADMIN", "ADMIN", "TEACHER", "STUDENT"]);
const statuses = new Set<UserStatus>(["ACTIVE", "SUSPENDED"]);
const one = (value: string | string[] | undefined) => (Array.isArray(value) ? value[0] : value) ?? "";

export default async function AdminUsersPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const context = await getAdminSectionContext("users");
  if (!context) return null;
  const raw = await searchParams;
  const requestedRole = one(raw.role) as UserRole;
  const requestedStatus = one(raw.status) as UserStatus;
  const query = (one(raw.q) || one(raw.account)).trim().slice(0, 100);
  const filters: AdminUserInitialFilters = {
    role: roles.has(requestedRole) ? requestedRole : "",
    status: statuses.has(requestedStatus) ? requestedStatus : "",
    query,
    schoolId: context.scopedSchoolId ?? one(raw.schoolId),
    schoolGroupId: one(raw.schoolGroupId),
  };
  const [result, allSchools] = await Promise.all([
    getAdminUserPage({
      page: 1,
      pageSize: 10,
      role: filters.role ? filters.role as UserRole : undefined,
      status: filters.status ? filters.status as UserStatus : undefined,
      schoolId: filters.schoolId || undefined,
      schoolGroupId: filters.schoolGroupId || undefined,
      query: filters.query || undefined,
    }),
    getSchoolDirectory(),
  ]);
  const schools = context.scopedSchoolId ? allSchools.filter(({ id }) => id === context.scopedSchoolId) : allSchools;
  return <AdminUsersPanel actor={context.actor} initialUsers={result.users} initialTotalCount={result.totalCount} initialPage={result.page} initialPageSize={result.pageSize} initialSearchTruncated={result.searchTruncated} schools={schools} initialFilters={filters} />;
}
