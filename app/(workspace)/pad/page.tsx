import type { Metadata } from "next";
import { getCurrentUser } from "@/lib/auth/current-user";
import { canCreateBoard as userCanCreateBoard } from "@/lib/auth/authorization";
import { getDashboardHomeData } from "@/lib/dashboard/queries";
import { getCourseDashboardData } from "@/lib/subjects/course-dashboard";
import { MyPadsView } from "@/components/home/my-pads-view";
import { CreateBoardActionsProvider } from "@/components/home/create-board-actions";
import { PAD_HOME_PATH } from "@/lib/routes";
import { redirectToLogin } from "@/lib/auth/page-guard";
import { APP_NAME } from "@/lib/brand";
import { DASHBOARD_BOARD_PAGE_SIZE } from "@/lib/board/queries";
import { PageNumberNavigation } from "@/components/ui/page-number-navigation";
import { PageShell } from "@/components/ui/page-layout";
import { redirect } from "next/navigation";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "내 패드",
  description: `내가 만들거나 참여한 ${APP_NAME} 작업공간입니다.`,
  robots: { index: false, follow: false },
};

function parsePage(value: string | string[] | undefined) {
  const page = Number(Array.isArray(value) ? value[0] : value);
  return Number.isInteger(page) && page > 0 ? Math.min(page, 100_000) : 1;
}

export default async function DashboardPage({ searchParams }: { searchParams: Promise<{ page?: string | string[]; q?: string | string[] }> }) {
  const user = await getCurrentUser();
  if (!user) {
    redirectToLogin(PAD_HOME_PATH);
  }

  const params = await searchParams;
  const queryValue = Array.isArray(params.q) ? params.q[0] : params.q;
  const query = queryValue?.trim().slice(0, 80) ?? "";
  const requestedPage = parsePage(params.page);
  const [{ myBoards, myBoardsTotalCount, myBoardsPage, myBoardsPageSize, accessRequestBoards, dashboardFolders, templateBoards }, courseData] = await Promise.all([
    getDashboardHomeData(user, query
      ? { includeArchived: false }
      : { page: requestedPage, pageSize: DASHBOARD_BOARD_PAGE_SIZE, includeArchived: false }),
    getCourseDashboardData(user),
  ]);
  const totalPages = Math.max(1, Math.ceil(myBoardsTotalCount / myBoardsPageSize));
  if (!query && requestedPage > totalPages) redirect(`/pad?page=${totalPages}`);
  const createBoardCourses = courseData.courses
    .filter((course) => course.editable)
    .map(({ id, name }) => ({ id, name }));
  return (
    <CreateBoardActionsProvider courses={createBoardCourses}>
      <PageShell>
        <MyPadsView
          boards={myBoards}
          accessRequestBoards={accessRequestBoards}
          folders={dashboardFolders}
          templateBoards={templateBoards}
          viewerName={user.name?.split(" ")[0] || "나"}
          viewerRole={user.role}
          canCreateBoard={userCanCreateBoard(user)}
          initialQuery={query}
        />
        <PageNumberNavigation basePath="/pad" page={myBoardsPage} totalPages={totalPages} />
      </PageShell>
    </CreateBoardActionsProvider>
  );
}
