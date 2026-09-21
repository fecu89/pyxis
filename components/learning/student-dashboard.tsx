import Link from "next/link";
import { notFound } from "next/navigation";
import { ClipboardList, LayoutGrid, ListChecks } from "lucide-react";
import type { CurrentUser } from "@/lib/auth/current-user";
import { PageShell } from "@/components/ui/page-layout";
import { PageNumberNavigation } from "@/components/ui/page-number-navigation";
import { StatCard } from "@/components/ui/data-display";
import { getCourseAccess, getLearningCourses, getLearningPage } from "@/lib/learning/queries";
import { LEARNING_LABELS, type LearningKind } from "@/lib/learning/types";
import { LearningCourses } from "./course-activities";
import { LearningItems } from "./learning-items";
import { LearningAutoRefresh } from "./learning-auto-refresh";

export async function StudentDashboard({ user, subjectId, kind, page }: {
  user: CurrentUser; subjectId?: string; kind?: LearningKind; page?: number;
}) {
  if (subjectId && !await getCourseAccess(subjectId, user)) notFound();
  const kinds: LearningKind[] = ["quiz", "pad", "form"];
  const [courses, ...pages] = await Promise.all([
    getLearningCourses(user),
    ...kinds.map(value => getLearningPage(user, { kind: value, subjectId,
      page: kind === value ? page : undefined, pageSize: kind === value ? 24 : 4 })),
  ]);
  const filterHref = (value?: LearningKind) => {
    const params = new URLSearchParams();
    if (subjectId) params.set("subjectId", subjectId);
    if (value) params.set("kind", value);
    return `/dashboard${params.size ? `?${params}` : ""}`;
  };
  const paths = { quiz: "/quiz", pad: "/pad", form: "/forms" };
  const icons = { quiz: ListChecks, pad: LayoutGrid, form: ClipboardList };
  return <PageShell>
    <LearningAutoRefresh />
    <div className="mb-8 grid grid-cols-3 gap-2 sm:gap-3">{pages.map(data => {
      const Icon = icons[data.kind];
      return <StatCard key={data.kind} compactMobile label={data.kind === "quiz" ? "퀴즈 활동" : `내 ${LEARNING_LABELS[data.kind]}`} value={data.total} icon={<Icon size={18} aria-hidden />} />;
    })}</div>
    <section className="mb-8"><h2 className="mb-3 text-lg font-black">내 교과목</h2><LearningCourses courses={courses} selectedSubjectId={subjectId} filter /></section>
    {subjectId || kind ? <nav className="mb-6 flex flex-wrap gap-2" aria-label="활동 종류">
      <Link href={filterHref()} prefetch={false} scroll={false} aria-current={!kind ? "true" : undefined} className={`button ${!kind ? "primary" : "ghost"}`}>전체 활동</Link>
      {kinds.map(value => <Link key={value} href={filterHref(value)} prefetch={false} scroll={false} aria-current={kind === value ? "true" : undefined} className={`button ${kind === value ? "primary" : "ghost"}`}>{LEARNING_LABELS[value]}</Link>)}
    </nav> : null}
    <div className="space-y-8">{pages.filter(data => !kind || data.kind === kind).map(data => <section key={data.kind}>
      <div className="mb-3 flex items-center justify-between gap-3"><h2 className="text-lg font-black">내 {LEARNING_LABELS[data.kind]} <span className="text-sm text-content-muted">{data.total}</span></h2>
        {!kind ? <Link href={subjectId ? filterHref(data.kind) : paths[data.kind]} prefetch={false} scroll={false} className="text-sm font-bold text-brand">전체 보기</Link> : null}</div>
      <LearningItems data={data} />
      {kind ? <PageNumberNavigation basePath="/dashboard" page={data.page} totalPages={data.totalPages} params={{ subjectId, kind }} /> : null}
    </section>)}</div>
  </PageShell>;
}
