import { getCurrentUser } from "@/lib/auth/current-user";
import { getDashboardHomeData } from "@/lib/dashboard/queries";
import { ArchivedBoards } from "@/components/home/home-shell";
import { redirectToLogin } from "@/lib/auth/page-guard";

export const dynamic = "force-dynamic";

// 예전에는 "/"(내 패드) 화면 맨 아래에 같이 있어서 "찾기 어렵다"는 피드백을 받아 전용 라우트로
// 뺐습니다. 사이드바의 "보관된 패드" 항목이 여기로 연결됩니다(components/shell/app-sidebar.tsx).
export default async function ArchivedBoardsPage() {
  const user = await getCurrentUser();
  if (!user) redirectToLogin("/pad/archived");
  const { archivedBoards } = await getDashboardHomeData(user);
  return <ArchivedBoards boards={archivedBoards} userId={user.id} isSuperAdmin={user.role === "SUPER_ADMIN"} />;
}
