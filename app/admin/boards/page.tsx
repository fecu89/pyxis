import { BoardManager } from "@/components/admin/resources/board-manager";
import { getAdminSectionContext } from "@/lib/admin/access";
import { getAdminBoardPage } from "@/lib/board/queries";

export default async function AdminBoardsPage() {
  const context = await getAdminSectionContext("boards");
  if (!context) return null;
  const result = await getAdminBoardPage({ page: 1, pageSize: 25, includeArchived: false });
  return <BoardManager initialBoards={result.boards} initialTotalCount={result.totalCount} initialPage={result.page} initialPageSize={result.pageSize} />;
}
