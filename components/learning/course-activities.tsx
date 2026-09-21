import Link from "next/link";
import { BookOpen } from "lucide-react";
import type { LearningCourse } from "@/lib/learning/types";

/** 학생은 모달 대신 대시보드의 과목 필터로 이동합니다. 관리 경로는 그대로 유지합니다. */
export function LearningCourses({ courses, selectedSubjectId, filter = false }: {
  courses: LearningCourse[]; selectedSubjectId?: string; filter?: boolean;
}) {
  if (!courses.length && !filter) return <p className="rounded-2xl border border-dashed border-line p-6 text-sm text-content-muted">아직 배정된 교과목이 없습니다.</p>;
  return <nav aria-label="교과목 필터"><ul className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
    {filter ? <li><Link href="/dashboard" prefetch={false} scroll={false} aria-current={!selectedSubjectId ? "true" : undefined}
      className={`course-card ${!selectedSubjectId ? "ring-2 ring-brand" : ""}`}><span className="course-card-body"><b>전체 과목</b><small>모든 수업 활동</small></span></Link></li> : null}
    {courses.map(course => <li key={course.id} className="min-w-0">
      <Link href={course.canManage ? `/courses/${course.id}` : `/dashboard?subjectId=${encodeURIComponent(course.id)}`}
        prefetch={false} scroll={false} aria-current={selectedSubjectId === course.id ? "true" : undefined}
        className={`course-card ${selectedSubjectId === course.id ? "ring-2 ring-brand" : ""}`}>
        <span className="course-card-icon"><BookOpen size={18} aria-hidden /></span>
        <span className="course-card-body"><b>{course.name}</b><small>{course.canManage ? "교과목 관리" : "퀴즈 · 패드 · 설문"}</small></span>
      </Link>
    </li>)}
  </ul></nav>;
}
