import { PageShell } from "@/components/ui/page-layout";
import { CourseList } from "@/components/courses/course-list";
import { getCurrentUser } from "@/lib/auth/current-user";
import { redirectToLogin } from "@/lib/auth/page-guard";
import { getCourseDashboardData } from "@/lib/subjects/course-dashboard";
import { getMetadata } from "@/utils/seo/getMetadata";

export const dynamic = "force-dynamic";
export const metadata = getMetadata({ title: "교과목", description: "학생·퀴즈·패드를 한 수업 단위로 묶습니다.", noIndex: true });

// 학생이 수백 명인 관리 화면을 /dashboard 본문에 직접 펼치지는 않습니다. URL과 본문은 독립된
// /courses로 유지하고, 탐색 계층만 대시보드 사이드바 아래에 둡니다.
export default async function CoursesPage() {
  const user = await getCurrentUser();
  if (!user) redirectToLogin("/courses");

  const data = await getCourseDashboardData(user);
  return (
    <PageShell>
      <CourseList initial={data} />
    </PageShell>
  );
}
