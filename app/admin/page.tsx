import { redirect } from "next/navigation";
import { canAccessAdminShell } from "@/lib/auth/authorization";
import { getCurrentUser } from "@/lib/auth/current-user";
import { redirectToLogin } from "@/lib/auth/page-guard";
import {
  ADMIN_SECTION_PATHS,
  canAccessAdminSection,
  firstAdminPath,
  getAdminCapabilities,
} from "@/lib/admin/access";
import { legacyAdminSection } from "@/lib/admin/navigation";

// `/admin`은 이제 화면을 렌더링하지 않습니다. 예전 북마크(`/admin?tab=...`)만 새 정식
// 하위 경로로 옮기고, 새 내비게이션은 처음부터 각 경로를 직접 가리킵니다.
export default async function AdminIndexPage({ searchParams }: { searchParams: Promise<{ tab?: string | string[] }> }) {
  const user = await getCurrentUser();
  if (!user) redirectToLogin("/admin");
  if (!canAccessAdminShell(user)) return null;

  const access = getAdminCapabilities(user);
  const rawTab = (await searchParams).tab;
  const tabValue = Array.isArray(rawTab) ? rawTab[0] : rawTab;
  const requested = legacyAdminSection(tabValue);
  redirect(requested && canAccessAdminSection(requested, access)
    ? ADMIN_SECTION_PATHS[requested]
    : firstAdminPath(access));
}
