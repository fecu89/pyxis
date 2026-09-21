import { notFound, redirect } from "next/navigation";
import { PageShell } from "@/components/ui/page-layout";
import { getCurrentUser } from "@/lib/auth/current-user";
import { redirectToLogin } from "@/lib/auth/page-guard";
import { getCourseSummary } from "@/lib/subjects/course-dashboard";
import { getCourseAccess } from "@/lib/learning/queries";
import { getMetadata } from "@/utils/seo/getMetadata";

export const dynamic = "force-dynamic";
export const metadata = getMetadata({ title: "교과목 구성", noIndex: true });

export default async function CourseDetailPage({ params }: { params: Promise<{ subjectId: string }> }) {
  const { subjectId } = await params;
  const user = await getCurrentUser();
  if (!user) redirectToLogin(`/courses/${subjectId}`);

  const access = await getCourseAccess(subjectId, user);
  if (!access) notFound();
  if (!access.canManage) redirect(`/dashboard?subjectId=${encodeURIComponent(subjectId)}`);

  // 권한을 확인하기 전에는 관리 컴포넌트와 학생 명단을 로드하지 않습니다.
  const [{ CourseDetail }, { getCourseRosterData }] = await Promise.all([
    import("@/components/learning/lazy-management").then(m => ({ CourseDetail: m.LazyCourseDetail })), import("@/lib/subjects/roster"),
  ]);
  const [course, initialRoster] = await Promise.all([
    getCourseSummary(subjectId, user.id), getCourseRosterData(subjectId, user, true),
  ]);
  if (!course) notFound();

  return (
    <PageShell>
      <CourseDetail initial={course} initialRoster={initialRoster} />
    </PageShell>
  );
}
