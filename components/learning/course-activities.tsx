"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { BookOpen, ChevronRight, LoaderCircle } from "lucide-react";
import { Modal } from "@/components/ui/modal";
import { InlineNotice } from "@/components/ui/feedback";
import { LearningItems } from "./learning-items";
import { LEARNING_LABELS, type LearningCourse, type LearningKind, type LearningPage } from "@/lib/learning/types";

function ActivityResults({ subjectId, kind }: { subjectId: string; kind: LearningKind }) {
  const [page, setPage] = useState(1);
  const [retry, setRetry] = useState(0);
  const [state, setState] = useState<{ data?: LearningPage; error?: string }>({});
  useEffect(() => {
    const controller = new AbortController();
    const params = new URLSearchParams({ kind, subjectId, page: String(page) });
    let busy = false;
    const load = () => {
      if (busy || controller.signal.aborted) return;
      busy = true;
      void fetch(`/api/me/learning?${params}`, { cache: "no-store", signal: controller.signal })
        .then(async response => {
          const data = await response.json();
          if (!response.ok) throw new Error(typeof data.error === "string" ? data.error : "활동을 불러오지 못했습니다.");
          if (!controller.signal.aborted) setState({ data });
        }).catch(cause => {
          if (!controller.signal.aborted) setState({ error: cause instanceof Error ? cause.message : "활동을 불러오지 못했습니다." });
        }).finally(() => { busy = false; });
    };
    load();
    const refresh = () => { if (document.visibilityState === "visible") load(); };
    const timer = kind === "quiz" ? window.setInterval(refresh, 15000) : undefined;
    if (kind === "quiz") window.addEventListener("focus", refresh);
    if (kind === "quiz") document.addEventListener("visibilitychange", refresh);
    return () => {
      controller.abort();
      window.clearInterval(timer);
      window.removeEventListener("focus", refresh);
      document.removeEventListener("visibilitychange", refresh);
    };
  }, [subjectId, kind, page, retry]);
  if (state.error) return <div><InlineNotice tone="error">{state.error}</InlineNotice><button type="button" className="button ghost mt-3" onClick={() => { setState({}); setRetry(n => n + 1); }}>다시 시도</button></div>;
  if (!state.data) return <p role="status" className="flex items-center gap-2 py-8 text-sm text-content-muted"><LoaderCircle className="animate-spin" size={18} />활동을 불러오는 중입니다.</p>;
  const data = state.data;
  function changePage(next: number) { setState({}); setPage(next); }
  return <>
    <p className="mb-3 text-xs text-content-muted">{kind === "quiz" ? "내 퀴즈 활동" : `내가 참여할 수 있는 ${LEARNING_LABELS[kind]}`} {data.total}개</p>
    <LearningItems data={data} />
    {data.totalPages > 1 ? <nav className="mt-4 flex items-center justify-center gap-3" aria-label="활동 페이지">
      <button type="button" className="button ghost" disabled={data.page <= 1} onClick={() => changePage(data.page - 1)}>이전</button>
      <span className="text-sm">{data.page} / {data.totalPages}</span>
      <button type="button" className="button ghost" disabled={data.page >= data.totalPages} onClick={() => changePage(data.page + 1)}>다음</button>
    </nav> : null}
  </>;
}

/** 관리 컴포넌트와의 import 연결이 없는 학생용 모달입니다. */
function CourseActivitiesModal({ course, onClose }: { course: LearningCourse; onClose: () => void }) {
  const [kind, setKind] = useState<LearningKind>("quiz");
  return <Modal open onClose={onClose} title={course.name} description="수업 활동을 선택해 바로 참여하세요." className="modal-lg">
    <div className="min-w-0 overflow-y-auto p-4 sm:p-6">
      <div className="mb-5 flex gap-2" role="group" aria-label="활동 종류">
        {(Object.keys(LEARNING_LABELS) as LearningKind[]).map(value => <button type="button" key={value}
          aria-pressed={kind === value} className={`button ${kind === value ? "primary" : "ghost"}`} onClick={() => setKind(value)}>{LEARNING_LABELS[value]}</button>)}
      </div>
      <ActivityResults key={kind} subjectId={course.id} kind={kind} />
    </div>
  </Modal>;
}

export function CourseActivities({ course, initiallyOpen = false }: { course: LearningCourse; initiallyOpen?: boolean }) {
  const [open, setOpen] = useState(initiallyOpen);
  return <>
    <button type="button" className="course-card w-full text-left" onClick={() => setOpen(true)} aria-haspopup="dialog">
      <span className="course-card-icon"><BookOpen size={18} /></span>
      <span className="course-card-body"><b>{course.name}</b><small>퀴즈 · 패드 · 설문 바로가기</small></span>
      <ChevronRight size={17} aria-hidden className="course-card-chevron" />
    </button>
    {open ? <CourseActivitiesModal course={course} onClose={() => setOpen(false)} /> : null}
  </>;
}

export function LearningCourses({ courses }: { courses: LearningCourse[] }) {
  if (!courses.length) return <p className="rounded-2xl border border-dashed border-line p-6 text-sm text-content-muted">아직 배정된 교과목이 없습니다.</p>;
  return <ul className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">{courses.map(course => <li key={course.id} className="min-w-0">
    {course.canManage ? <Link href={`/courses/${course.id}`} prefetch={false} className="course-card"><span className="course-card-body"><b>{course.name}</b><small>교과목 관리</small></span></Link>
      : <CourseActivities course={course} />}
  </li>)}</ul>;
}
