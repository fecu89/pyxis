import Link from "next/link";
import { getCurrentUser } from "@/lib/auth/current-user";
import { redirectToLogin } from "@/lib/auth/page-guard";
import { getActivityPage } from "@/lib/activity/report";
import { formatDateTime } from "@/lib/format";
import { StatCard, StatusBadge } from "@/components/ui/data-display";
import { PageHeader, PageShell } from "@/components/ui/page-layout";
import { getRecentContentVisits } from "@/lib/dashboard/visits";
import { getPrisma } from "@/lib/prisma";
import { getMetadata } from "@/utils/seo/getMetadata";
import { getCourseDashboardData } from "@/lib/subjects/course-dashboard";

export const dynamic = "force-dynamic";
export const metadata = getMetadata({ title: "대시보드", description: "퀴즈와 패드의 현황을 한눈에 봅니다.", noIndex: true });

const RECENT_TYPE_LABEL = { PAD: "패드", QUIZ: "퀴즈", FORM: "설문" } as const;

// 퀴즈·패드를 아우르는 통합 현황입니다. 로그인 후 기본 도착지이고, 각 섹션의 목록으로
// 들어가는 진입점 역할만 합니다 — 상세 조작은 각 섹션이 담당합니다.
export default async function DashboardPage() {
  const user = await getCurrentUser();
  if (!user) redirectToLogin("/dashboard");

  if (user.role === "STUDENT") {
    const { StudentDashboard } = await import("@/components/learning/student-dashboard");
    return <StudentDashboard user={user} />;
  }

  const prisma = getPrisma();
  const [quizCount, boardCount, recent, recentVisits, courseData] = await Promise.all([
    prisma.quiz.count({ where: { ownerId: user.id, deletedAt: null } }),
    prisma.board.count({ where: { ownerId: user.id, deletedAt: null } }),
    getActivityPage(user, { page: 1 }),
    getRecentContentVisits(user, 8),
    getCourseDashboardData(user),
  ]);
  const running = recent.items.filter((item) => item.endedAt === null).length;

  return (
    <PageShell>
      <PageHeader
        eyebrow="DASHBOARD"
        title={`${user.name ?? "환영합니다"}님의 현황`}
        description="퀴즈와 패드에서 일어나는 일을 한곳에서 봅니다."
      />

      <div className="mb-8 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard label="내 퀴즈" value={quizCount} icon={<span aria-hidden>Q</span>} tone="brand" hint="소유한 퀴즈" />
        <StatCard label="내 패드" value={boardCount} icon={<span aria-hidden>P</span>} tone="info" hint="소유한 패드" />
        <StatCard label="진행 중" value={running} icon={<span aria-hidden>▶</span>} tone="warning" hint="아직 끝나지 않은 활동" />
        <StatCard label={courseData.canManage ? "내 교과목" : "배정 교과목"} value={courseData.courses.length} icon={<span aria-hidden>교</span>} tone="accent" hint={courseData.canManage ? "운영 중인 수업" : "참여 중인 수업"} />
      </div>

      {/* 교과목 구성은 /courses가 담당합니다. 학생이 수백 명이면 대시보드 한 섹션에 담기지
          않아서 독립 구역으로 뺐고, 여기에는 요약과 바로가기만 남깁니다. */}
      <section className="mb-10">
        <div className="mb-3 flex items-end justify-between">
          <h2 className="text-lg font-black tracking-tight text-content">교과목</h2>
          <Link href="/courses" className="text-sm font-bold text-brand hover:underline">관리하기</Link>
        </div>
        {courseData.courses.length === 0 ? (
          <p className="rounded-2xl border border-dashed border-line-strong bg-surface/60 px-6 py-10 text-center text-sm text-content-muted">
            아직 교과목이 없어요. <Link href="/courses" className="font-bold text-brand hover:underline">교과목</Link>을 만들어 학급·퀴즈·패드를 한 수업으로 묶어 보세요.
          </p>
        ) : (
          <ul className="grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
            {courseData.courses.slice(0, 6).map((course) => (
              <li key={course.id}>
                <Link href={`/courses/${course.id}`} className="flex items-center gap-3 rounded-2xl border border-line bg-surface px-4 py-3 transition hover:bg-surface-hover">
                  <span className="min-w-0 flex-1 truncate text-sm font-black text-content">{course.name}</span>
                  <span className="shrink-0 text-xs text-content-muted">학생 {course.studentCount.toLocaleString("ko")}</span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section>
        <div className="mb-3 flex items-end justify-between">
          <h2 className="text-lg font-black tracking-tight text-content">최근 방문</h2>
        </div>
        {recentVisits.length === 0 ? (
          <p className="rounded-2xl border border-dashed border-line-strong bg-surface/60 px-6 py-10 text-center text-sm text-content-muted">
            아직 방문한 콘텐츠가 없어요. 퀴즈나 패드, 설문을 열면 여기에 표시됩니다.
          </p>
        ) : (
          <ul className="grid gap-2">
            {recentVisits.map((item) => (
              <li key={item.key}>
                <Link href={item.href} className="flex items-center gap-3 rounded-2xl border border-line bg-surface px-4 py-3 transition hover:bg-surface-hover">
                  <StatusBadge status="PUBLISHED" label={RECENT_TYPE_LABEL[item.type]} />
                  <span className="min-w-0 flex-1 truncate text-sm font-black text-content">{item.title}</span>
                  <span className="shrink-0 text-xs text-content-muted">{formatDateTime(item.lastVisitedAt)}</span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>
    </PageShell>
  );
}
