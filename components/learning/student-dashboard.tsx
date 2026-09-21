import Link from "next/link";
import { ClipboardList, LayoutGrid, ListChecks } from "lucide-react";
import type { CurrentUser } from "@/lib/auth/current-user";
import { PageHeader, PageShell } from "@/components/ui/page-layout";
import { StatCard } from "@/components/ui/data-display";
import { getLearningCourses, getLearningPage } from "@/lib/learning/queries";
import { LEARNING_LABELS } from "@/lib/learning/types";
import { LearningCourses } from "./course-activities";
import { LearningItems } from "./learning-items";
import { LearningAutoRefresh } from "./learning-auto-refresh";

export async function StudentDashboard({ user }: { user: CurrentUser }) {
  const [courses, ...pages] = await Promise.all([
    getLearningCourses(user),
    getLearningPage(user, { kind: "quiz", pageSize: 4 }),
    getLearningPage(user, { kind: "pad", pageSize: 4 }),
    getLearningPage(user, { kind: "form", pageSize: 4 }),
  ]);
  const paths = { quiz: "/quiz", pad: "/pad", form: "/forms" };
  const icons = { quiz: ListChecks, pad: LayoutGrid, form: ClipboardList };
  return <PageShell>
    <LearningAutoRefresh />
    <PageHeader eyebrow="MY LEARNING" title={`${user.name || "학생"}님의 수업`} description="참여 중인 퀴즈·패드·설문으로 바로 이동하세요." />
    <div className="mb-8 grid grid-cols-3 gap-2 sm:gap-3">{pages.map(data => {
      const Icon = icons[data.kind];
      return <StatCard key={data.kind} compactMobile label={data.kind === "quiz" ? "퀴즈 활동" : `내 ${LEARNING_LABELS[data.kind]}`} value={data.total} icon={<Icon size={18} aria-hidden />} />;
    })}</div>
    <section className="mb-8"><h2 className="mb-3 text-lg font-black">내 교과목</h2><LearningCourses courses={courses} /></section>
    <div className="space-y-8">{pages.map(data => <section key={data.kind}>
      <div className="mb-3 flex items-center justify-between gap-3"><h2 className="text-lg font-black">내 {LEARNING_LABELS[data.kind]} <span className="text-sm text-content-muted">{data.total}</span></h2>
        <Link href={paths[data.kind]} prefetch={false} className="text-sm font-bold text-brand">전체 보기</Link></div>
      <LearningItems data={data} />
    </section>)}</div>
  </PageShell>;
}
