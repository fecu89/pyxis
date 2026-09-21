import { notFound } from "next/navigation";
import { PageShell } from "@/components/ui/page-layout";
import { CourseDetail } from "@/components/courses/course-detail";
import { getCurrentUser } from "@/lib/auth/current-user";
import { redirectToLogin } from "@/lib/auth/page-guard";
import { getCourseSummary } from "@/lib/subjects/course-dashboard";
import { getCourseRosterData, rosterMemberWhere } from "@/lib/subjects/roster";
import { getPrisma } from "@/lib/prisma";
import { getMetadata } from "@/utils/seo/getMetadata";

export const dynamic = "force-dynamic";
export const metadata = getMetadata({ title: "교과목 구성", noIndex: true });

export default async function CourseDetailPage({ params }: { params: Promise<{ subjectId: string }> }) {
  const { subjectId } = await params;
  const user = await getCurrentUser();
  if (!user) redirectToLogin(`/courses/${subjectId}`);

  const course = await getCourseSummary(subjectId, user.id);
  if (!course) notFound();

  // 소유자가 아니면 자기가 그 교과목 명단에 들어 있을 때만 볼 수 있습니다. 명단 조건을 그대로
  // 재사용해 학급 연결로 들어온 학생도 자기 교과목을 열 수 있게 합니다.
  if (!course.editable) {
    const member = await getPrisma().user.count({ where: { AND: [{ id: user.id }, rosterMemberWhere(subjectId)] } });
    if (!member) notFound();
  }

  const initialRoster = await getCourseRosterData(subjectId, user, course.editable);

  return (
    <PageShell>
      <CourseDetail initial={course} initialRoster={initialRoster} />
    </PageShell>
  );
}
