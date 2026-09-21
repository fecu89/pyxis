"use client";

import { lazy, Suspense, type ComponentProps, type ReactNode } from "react";

// 서버의 권한 분기에서 이 경계가 렌더링될 때만 관리 화면 청크를 요청합니다.
const CourseDetail = lazy(() => import("@/components/courses/course-detail").then(m => ({ default: m.CourseDetail })));
const CourseList = lazy(() => import("@/components/courses/course-list").then(m => ({ default: m.CourseList })));
const QuizLibrary = lazy(() => import("@/components/quiz/quiz-library").then(m => ({ default: m.QuizLibrary })));
const FormList = lazy(() => import("@/components/forms/form-list").then(m => ({ default: m.FormList })));

function ManagementBoundary({ children }: { children: ReactNode }) {
  return <Suspense fallback={<p role="status" className="p-6 text-sm text-content-muted">화면을 불러오는 중…</p>}>{children}</Suspense>;
}

export function LazyCourseDetail(props: ComponentProps<typeof CourseDetail>) {
  return <ManagementBoundary><CourseDetail {...props} /></ManagementBoundary>;
}

export function LazyCourseList(props: ComponentProps<typeof CourseList>) {
  return <ManagementBoundary><CourseList {...props} /></ManagementBoundary>;
}

export function LazyQuizLibrary(props: ComponentProps<typeof QuizLibrary>) {
  return <ManagementBoundary><QuizLibrary {...props} /></ManagementBoundary>;
}

export function LazyFormList(props: ComponentProps<typeof FormList>) {
  return <ManagementBoundary><FormList {...props} /></ManagementBoundary>;
}
