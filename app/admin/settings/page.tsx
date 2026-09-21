import { SystemSettingsPanel } from "@/components/admin/system-settings-panel";
import { getAdminSectionContext } from "@/lib/admin/access";
import { readAdminSettings } from "@/lib/settings/admin-settings";

export default async function AdminSettingsPage() {
  const context = await getAdminSectionContext("settings");
  if (!context) return null;
  return <SystemSettingsPanel initialSettings={await readAdminSettings()} />;
}
