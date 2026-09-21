import { ThemePanel } from "@/components/admin/theme-panel";
import { getAdminSectionContext } from "@/lib/admin/access";
import { getBrandTheme } from "@/lib/settings/brand-theme";

export default async function AdminThemePage() {
  const context = await getAdminSectionContext("theme");
  if (!context) return null;
  return <ThemePanel initialTheme={await getBrandTheme()} />;
}
