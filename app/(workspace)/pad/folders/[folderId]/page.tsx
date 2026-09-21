import { notFound } from "next/navigation";
import { getCurrentUser } from "@/lib/auth/current-user";
import { getDashboardHomeData } from "@/lib/dashboard/queries";
import { canCreateBoard as userCanCreateBoard } from "@/lib/auth/authorization";
import { FolderView } from "@/components/home/folder-view";
import { redirectToLogin } from "@/lib/auth/page-guard";

export const dynamic = "force-dynamic";

// 폴더 목록이 사이드바로 옮겨가면서 폴더마다 이 라우트를 갖습니다. 새 쿼리를 만들지 않고
// getDashboardHomeData가 이미 계산해 둔 폴더·패드 목록을 그대로 씁니다(React cache()로
// layout과 조회를 공유). 폴더는 사용자 소유만 조회되므로 여기서 없으면 404입니다.
export default async function FolderPage({ params }: { params: Promise<{ folderId: string }> }) {
  const user = await getCurrentUser();
  const { folderId } = await params;
  if (!user) redirectToLogin(`/pad/folders/${folderId}`);
  const { myBoards, dashboardFolders } = await getDashboardHomeData(user);
  const folder = dashboardFolders.find((item) => item.id === folderId);
  if (!folder) notFound();
  return <FolderView folder={folder} folders={dashboardFolders} boards={myBoards} canCreateBoard={userCanCreateBoard(user)} />;
}
