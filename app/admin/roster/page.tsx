import { StudentRosterImport } from "@/components/admin/student-roster-import";
import { getAdminSectionContext } from "@/lib/admin/access";
import { getSchoolDirectory } from "@/lib/users/organization";

export default async function AdminRosterPage() {
  const context = await getAdminSectionContext("roster");
  if (!context) return null;
  const allSchools = await getSchoolDirectory();
  const schools = context.scopedSchoolId ? allSchools.filter(({ id }) => id === context.scopedSchoolId) : allSchools;
  return <StudentRosterImport schools={schools} />;
}
