"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { FileQuestion, LayoutGrid, Pencil, Trash2, Users } from "lucide-react";
import { useDialog } from "@/components/ui/app-dialog";
import { InlineNotice } from "@/components/ui/feedback";
import { RosterPanel } from "@/components/courses/roster-panel";
import { ResourcePanel } from "@/components/courses/resource-panel";
import { invalidateCourseOptions } from "@/components/courses/course-select";
import { COURSE_LIST_PATH } from "@/lib/route-paths";
import type { CourseSummary } from "@/lib/subjects/course-dashboard";
import type { CourseRosterData } from "@/lib/subjects/roster";

type Tab = "students" | "quizzes" | "boards";

async function readJson(response: Response) {
  const data = await response.json().catch(() => ({})) as Record<string, unknown>;
  if (!response.ok) throw new Error(typeof data.error === "string" ? data.error : "요청을 처리하지 못했습니다.");
  return data;
}

/** 교과목 하나의 구성 화면. 학생·퀴즈·패드를 탭으로 나눠 각각 페이지 단위로 다룹니다. */
export function CourseDetail({ initial, initialRoster }: { initial: CourseSummary; initialRoster: CourseRosterData }) {
  const router = useRouter();
  const dialog = useDialog();
  const [tab, setTab] = useState<Tab>("students");
  const [error, setError] = useState<string | null>(null);

  // 개수·이름은 **서버 prop을 그대로** 씁니다. 예전에는 useState(initial)로 한 번 얼려 뒀는데,
  // router.refresh()가 새 prop을 내려보내도 state는 첫 값을 계속 들고 있어서 명단을 바꿔도
  // 헤더와 탭 배지가 옛 숫자로 남았습니다(사이드바만 갱신돼 더 헷갈렸습니다).
  const course = initial;

  async function rename() {
    const nextName = await dialog.promptText({
      title: "교과목 이름 바꾸기",
      label: "교과목 이름",
      defaultValue: course.name,
      maxLength: 60,
      validate: (value) => value ? null : "이름을 입력해 주세요.",
    });
    if (!nextName || nextName === course.name) return;
    try {
      await readJson(await fetch(`/api/subjects/${course.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: nextName }),
      }));
      invalidateCourseOptions();
      // 새 이름·개수는 refresh가 내려주는 prop으로 반영됩니다.
      router.refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "이름을 바꾸지 못했습니다.");
    }
  }

  async function remove() {
    const ok = await dialog.confirm({
      title: `'${course.name}' 교과목을 삭제할까요?`,
      description: "퀴즈와 패드는 삭제되지 않고 미분류로 이동하며, 학생 배정과 학급 연결만 해제됩니다.",
      danger: true,
      confirmLabel: "삭제",
    });
    if (!ok) return;
    try {
      await readJson(await fetch(`/api/subjects/${course.id}`, { method: "DELETE" }));
      invalidateCourseOptions();
      router.push(COURSE_LIST_PATH);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "교과목을 삭제하지 못했습니다.");
    }
  }

  // 구성이 바뀌면 사이드바의 인원수와 상단 요약도 함께 맞춰야 합니다.
  function refreshCounts() {
    router.refresh();
  }

  const tabs: Array<{ key: Tab; label: string; count: number; icon: React.ReactNode }> = [
    { key: "students", label: "학생", count: course.studentCount, icon: <Users size={15} /> },
    { key: "quizzes", label: "퀴즈", count: course.quizCount, icon: <FileQuestion size={15} /> },
    { key: "boards", label: "패드", count: course.boardCount, icon: <LayoutGrid size={15} /> },
  ];

  return (
    <div className="course-detail">
      <header className="course-detail-head">
        <div>
          <p className="text-xs font-black uppercase tracking-[0.18em] text-brand">COURSE</p>
          <h1>{course.name}</h1>
          <p className="course-detail-sub">
            {course.editable ? null : <>{course.ownerName ?? "다른"} 선생님의 교과목 · 읽기 전용 · </>}
            학생 {course.studentCount.toLocaleString("ko")}명
            {course.groupCount > 0 ? ` · 학급 ${course.groupCount}개 연결` : ""}
          </p>
        </div>
        {course.editable ? (
          <div className="course-detail-actions">
            <button type="button" className="button ghost" onClick={() => void rename()}><Pencil size={15} />이름 변경</button>
            <button type="button" className="button danger" onClick={() => void remove()}><Trash2 size={15} />삭제</button>
          </div>
        ) : null}
      </header>

      {error ? <InlineNotice tone="error">{error}</InlineNotice> : null}

      <nav className="course-tabs" role="tablist" aria-label="교과목 구성">
        {tabs.map((item) => (
          <button
            key={item.key}
            type="button"
            role="tab"
            aria-selected={tab === item.key}
            className="course-tab"
            onClick={() => setTab(item.key)}
          >
            {item.icon}
            {item.label}
            <small>{item.count.toLocaleString("ko")}</small>
          </button>
        ))}
      </nav>

      <div className="course-tab-panel" role="tabpanel">
        {tab === "students" ? <RosterPanel subjectId={course.id} editable={course.editable} initialRoster={initialRoster} onChanged={refreshCounts} /> : null}
        {tab === "quizzes" ? (
          course.editable
            ? <ResourcePanel subjectId={course.id} kind="quiz" onChanged={refreshCounts} />
            : <p className="course-picker-empty">이 교과목의 퀴즈는 담당 선생님이 구성합니다.</p>
        ) : null}
        {tab === "boards" ? (
          course.editable
            ? <ResourcePanel subjectId={course.id} kind="board" onChanged={refreshCounts} />
            : <p className="course-picker-empty">이 교과목의 패드는 담당 선생님이 구성합니다.</p>
        ) : null}
      </div>
    </div>
  );
}
