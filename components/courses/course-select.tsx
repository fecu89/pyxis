"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { LoaderCircle } from "lucide-react";
import { notifySidebarDataChanged } from "@/lib/sidebar-events";

export type CourseOption = { id: string; name: string };

/**
 * 교과목 선택지를 한 번만 읽어 화면 전체가 공유합니다. 카드 메뉴를 열 때마다 조회하면
 * 목록을 훑는 동안 같은 요청이 수십 번 나갑니다.
 *
 * `options`를 직접 넘기는 화면(퀴즈 보관함은 필터용으로 이미 갖고 있습니다)은 이 경로를 타지
 * 않습니다. 패드 목록처럼 PadGrid가 네 화면에서 쓰여 prop을 네 갈래로 흘려보내야 하는 쪽만
 * 자체 조회를 씁니다.
 */
let sharedOptions: CourseOption[] | null = null;
let sharedRequest: Promise<CourseOption[]> | null = null;

async function loadCourseOptions(): Promise<CourseOption[]> {
  if (sharedOptions) return sharedOptions;
  sharedRequest ??= fetch("/api/subjects", { cache: "no-store" })
    .then((response) => response.ok ? response.json() : { subjects: [] })
    .then((data: { subjects?: Array<{ id: string; name: string }> }) => {
      sharedOptions = (data.subjects ?? []).map(({ id, name }) => ({ id, name }));
      return sharedOptions;
    })
    .catch(() => [])
    .finally(() => { sharedRequest = null; });
  return sharedRequest;
}

/** 교과목을 만들거나 지운 뒤 다음 조회가 새 목록을 읽도록 캐시를 버립니다. */
export function invalidateCourseOptions() {
  sharedOptions = null;
  notifySidebarDataChanged("dashboard");
}

/**
 * 목록 화면(내 퀴즈·내 패드)에서 항목 하나의 교과목을 바로 바꿉니다. 교과목 화면까지 들어가지
 * 않고도 분류할 수 있어야 한다는 요구에서 나왔고, 반대 방향(교과목에 여러 개 붙이기)은
 * `/courses/[subjectId]`의 ResourcePanel이 담당합니다.
 */
export function CourseSelect({
  kind,
  itemId,
  value,
  options,
  label,
  refreshAfterChange = true,
}: {
  kind: "quiz" | "board";
  itemId: string;
  value: string | null;
  /** 생략하면 `/api/subjects`에서 한 번 읽어 화면 전체가 공유합니다. */
  options?: CourseOption[];
  label: string;
  /** 교과목별 서버 그룹을 즉시 다시 그려야 하는 화면만 true로 둡니다. */
  refreshAfterChange?: boolean;
}) {
  const router = useRouter();
  const [current, setCurrent] = useState(value ?? "");
  const [busy, setBusy] = useState(false);
  const [loaded, setLoaded] = useState<CourseOption[]>(options ?? sharedOptions ?? []);

  useEffect(() => {
    if (options) return;
    let alive = true;
    void loadCourseOptions().then((result) => { if (alive) setLoaded(result); });
    return () => { alive = false; };
  }, [options]);

  const choices = options ?? loaded;

  async function change(next: string) {
    const previous = current;
    setCurrent(next);
    setBusy(true);
    try {
      const response = await fetch("/api/subjects/assign", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ kind, id: itemId, subjectId: next || null }),
      });
      if (!response.ok) {
        setCurrent(previous);
        return;
      }
      // 목록의 교과목별 묶음과 사이드바 인원수가 함께 바뀌므로 서버 데이터를 다시 읽습니다.
      if (refreshAfterChange) router.refresh();
    } catch {
      setCurrent(previous);
    } finally {
      setBusy(false);
    }
  }

  return (
    <label className="course-inline-select" onClick={(event) => event.stopPropagation()}>
      <span className="sr-only">{label}</span>
      <select value={current} disabled={busy || choices.length === 0} onChange={(event) => void change(event.target.value)}>
        <option value="">미분류</option>
        {choices.map((option) => <option key={option.id} value={option.id}>{option.name}</option>)}
      </select>
      {busy ? <LoaderCircle size={12} className="spin" aria-hidden /> : null}
    </label>
  );
}
