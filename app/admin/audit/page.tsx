import { AdminAuditPanel } from "@/components/admin/admin-audit-panel";
import { getAdminSectionContext } from "@/lib/admin/access";
import { getAuditLogPage } from "@/lib/auth/audit";

export default async function AdminAuditPage() {
  const context = await getAdminSectionContext("audit");
  if (!context) return null;
  const result = await getAuditLogPage({ limit: 25 });
  return <AdminAuditPanel initialLogs={result.logs} initialCursor={result.nextCursor} />;
}
