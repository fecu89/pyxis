"use client";

import { useState, type FormEvent } from "react";
import Link from "next/link";
import { BookOpen, ChevronRight, ClipboardList, LayoutGrid, Link2, FileQuestion, Plus, Users } from "lucide-react";
import { EmptyState, InlineNotice } from "@/components/ui/feedback";
import { invalidateCourseOptions } from "@/components/courses/course-select";
import { COURSE_LIST_PATH } from "@/lib/route-paths";
import type { CourseDashboardData, CourseSummary } from "@/lib/subjects/course-dashboard";

async function readJson(response: Response) {
  const data = await response.json().catch(() => ({})) as Record<string, unknown>;
  if (!response.ok) throw new Error(typeof data.error === "string" ? data.error : "요청을 처리하지 못했습니다.");
  return data;
}

/**
 * 교과목 목록입니다. 예전에는 이 화면이 대시보드 본문 안에서 각 교과목을 펼쳐 학생·퀴즈·패드
 * 체크박스를 통째로 그렸는데, 학생이 수백 명이면 담기지 않습니다. 이제 여기는 목록과 생성만
 * 맡고 구성은 교과목별 상세 화면이 담당합니다.
 */
export function CourseList({ initial }: { initial: CourseDashboardData }) {
  const [courses, setCourses] = useState(initial.courses);
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function addCourse(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!name.trim() || busy) return;
    setBusy(true);
    setError(null);
    try {
      const data = await readJson(await fetch("/api/subjects", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name }),
      }));
      const subject = data.subject as { id: string; name: string };
      const created: CourseSummary = {
        id: subject.id,
        name: subject.name,
        href: `${COURSE_LIST_PATH}/${subject.id}`,
        quizCount: 0,
        boardCount: 0,
        formCount: 0,
        studentCount: 0,
        groupCount: 0,
        editable: true,
      };
      setCourses((current) => [...current.filter((item) => item.id !== created.id), created]
        .sort((left, right) => left.name.localeCompare(right.name, "ko")));
      invalidateCourseOptions();
      setName("");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "교과목을 추가하지 못했습니다.");
    } finally {
      setBusy(false);
    }
  }

  const canCreate = initial.canAssignStudents;

  return (
    <section aria-labelledby="course-list-title">
      <div className="mb-5 flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="text-xs font-black uppercase tracking-[0.18em] text-brand">COURSES</p>
          <h2 id="course-list-title" className="mt-2 text-2xl font-black tracking-tight text-content">
            {canCreate ? "교과목 관리" : "내 교과목"}
          </h2>
          <p className="mt-2 text-sm leading-6 text-content-muted">
            {canCreate
              ? "학급을 통째로 연결하거나 학생을 개별로 넣고, 퀴즈·패드를 한 수업 단위로 묶습니다."
              : "선생님이 배정한 교과목과 연결된 활동을 확인할 수 있습니다."}
          </p>
        </div>
        {canCreate ? (
          <form onSubmit={addCourse} className="flex w-full max-w-md gap-2">
            <label className="sr-only" htmlFor="new-course-name">새 교과목 이름</label>
            <input
              id="new-course-name"
              value={name}
              onChange={(event) => setName(event.target.value)}
              maxLength={60}
              placeholder="예: 수학, 과학, 한국사"
              className="min-h-11 min-w-0 flex-1 rounded-xl border border-line bg-surface px-4 text-sm font-bold text-content outline-none placeholder:text-content-subtle focus:border-brand"
            />
            <button type="submit" disabled={!name.trim() || busy} className="inline-flex min-h-11 items-center gap-2 rounded-xl bg-brand-strong px-4 text-sm font-black text-on-brand disabled:opacity-45">
              <Plus size={16} />추가
            </button>
          </form>
        ) : null}
      </div>

      {error ? <div className="mb-4"><InlineNotice tone="error">{error}</InlineNotice></div> : null}

      {courses.length ? (
        <ul className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {courses.map((course) => (
            <li key={course.id}>
              <Link href={course.href} prefetch={false} className="course-card">
                <span className="course-card-icon"><BookOpen size={18} /></span>
                <span className="course-card-body">
                  <b>{course.name}</b>
                  <small>
                    {course.editable ? null : `${course.ownerName ?? "다른"} 선생님 · `}
                    학생 {course.studentCount.toLocaleString("ko")}명
                    {course.groupCount > 0 ? ` (학급 ${course.groupCount})` : ""}
                  </small>
                  <span className="course-card-meta">
                    <span><FileQuestion size={13} aria-hidden />{course.quizCount}</span>
                    <span><LayoutGrid size={13} aria-hidden />{course.boardCount}</span>
                    <span><ClipboardList size={13} aria-hidden />{course.formCount}</span>
                    {course.groupCount > 0 ? <span><Link2 size={13} aria-hidden />{course.groupCount}</span> : null}
                    <span><Users size={13} aria-hidden />{course.studentCount}</span>
                  </span>
                </span>
                <ChevronRight size={17} aria-hidden className="course-card-chevron" />
              </Link>
            </li>
          ))}
        </ul>
      ) : (
        <EmptyState
          icon={<BookOpen />}
          title={canCreate ? "등록한 교과목이 없어요" : "배정된 교과목이 없어요"}
          description={canCreate
            ? "교과목을 추가한 뒤 학급을 연결하고 퀴즈·패드를 묶어 보세요."
            : "교과목에 배정되면 이곳에서 수업 활동을 확인할 수 있어요."}
        />
      )}
    </section>
  );
}
