import { getCurrentUser } from "@/lib/auth/current-user";
import { getDashboardHomeData } from "@/lib/dashboard/queries";
import { canCreateBoard as userCanCreateBoard } from "@/lib/auth/authorization";
import { FavoritesView } from "@/components/home/favorites-view";
import { redirectToLogin } from "@/lib/auth/page-guard";

export const dynamic = "force-dynamic";

export default async function FavoritesPage() {
  const user = await getCurrentUser();
  if (!user) redirectToLogin("/pad/favorites");
  const { myBoards, dashboardFolders } = await getDashboardHomeData(user);
  return <FavoritesView boards={myBoards} folders={dashboardFolders} canCreateBoard={userCanCreateBoard(user)} />;
}
