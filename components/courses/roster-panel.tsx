"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ChevronLeft, ChevronRight, Link2, Link2Off, LoaderCircle, Trash2, UserPlus, Users } from "lucide-react";
import { useDialog } from "@/components/ui/app-dialog";
import { InlineNotice } from "@/components/ui/feedback";
import { PagedSelectableList, SelectableList, type SelectableListPage } from "@/components/ui/selectable-list";
import type { CourseGroupLink, RosterPage, RosterStudent } from "@/lib/subjects/roster";

type RosterResponse = RosterPage & { groups: CourseGroupLink[]; linkableGroups: CourseGroupLink[]; expanded?: number };

async function readJson(response: Response) {
  const data = await response.json().catch(() => ({})) as Record<string, unknown>;
  if (!response.ok) throw new Error(typeof data.error === "string" ? data.error : "요청을 처리하지 못했습니다.");
  return data;
}

// 학급 이름은 학교마다 "5반"으로도 "3학년 5반"으로도 들어옵니다. 앞에 학년을 무조건 붙이면
// 후자가 "3학년 3학년 5반"이 되므로, 이미 들어 있으면 이름만 씁니다.
function groupLabel(group: CourseGroupLink) {
  if (!group.gradeName) return group.name;
  return group.name.includes(group.gradeName) ? group.name : `${group.gradeName} ${group.name}`;
}

/**
 * 교과목 명단 화면입니다. 명단은 **개별 배정 ∪ 연결된 학급**이라 화면도 두 부분입니다.
 *
 *  · 위: 연결된 학급 — 반 명단이 바뀌면 자동으로 따라옵니다.
 *  · 아래: 실제 학생 목록 — 50명씩 페이지로 읽습니다.
 *
 * 학급 연결로 들어온 학생은 개별 제거가 안 됩니다(연결을 끊거나, 그 반을 "학생 개별 추가"로
 * 바꾼 뒤에야 개별로 다룰 수 있습니다). 그래서 행마다 어느 경로로 들어왔는지 배지로 보여 줍니다.
 */
export function RosterPanel({ subjectId, editable, initialRoster, onChanged }: { subjectId: string; editable: boolean; initialRoster: RosterResponse; onChanged?: () => void }) {
  const dialog = useDialog();
  const [roster, setRoster] = useState<RosterResponse>(initialRoster);
  const [page, setPage] = useState(1);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [pickedGroups, setPickedGroups] = useState<Set<string>>(new Set());
  const [classFilter, setClassFilter] = useState("");
  const [reloadKey, setReloadKey] = useState(0);
  const skipNextRosterLoad = useRef(true);

  const loadRoster = useCallback(async (targetPage: number, signal?: AbortSignal) => {
    try {
      const data = await readJson(await fetch(`/api/subjects/${subjectId}/roster?page=${targetPage}`, { cache: "no-store", signal }));
      setRoster(data as unknown as RosterResponse);
      setError(null);
    } catch (cause) {
      if (signal?.aborted) return;
      setError(cause instanceof Error ? cause.message : "명단을 불러오지 못했습니다.");
    }
  }, [subjectId]);

  // loadRoster는 fetch를 await한 뒤에야 setState를 부르지만, effect 본문에서 곧바로 호출하면
  // react-hooks/set-state-in-effect가 동기 호출로 봅니다. async 래퍼를 한 겹 둡니다.
  useEffect(() => {
    if (skipNextRosterLoad.current) {
      skipNextRosterLoad.current = false;
      return;
    }
    const controller = new AbortController();
    async function initialLoad() { await loadRoster(page, controller.signal); }
    void initialLoad();
    return () => controller.abort();
  }, [loadRoster, page]);

  async function mutate(body: Record<string, unknown>, successNote: string) {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const data = await readJson(await fetch(`/api/subjects/${subjectId}/roster`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      }));
      const next = data as unknown as RosterResponse;
      setRoster(next);
      skipNextRosterLoad.current = page !== 1;
      setPage(1);
      setPicked(new Set());
      setPickedGroups(new Set());
      // 후보 목록도 다시 읽어야 방금 넣은 학생이 후보에서 빠집니다.
      setReloadKey((value) => value + 1);
      setNotice(typeof next.expanded === "number" && next.expanded > 0 ? `${next.expanded}명을 개별 배정으로 복사했습니다.` : successNote);
      // 탭 배지·상단 요약·사이드바 인원수는 서버가 계산해 내려주므로 함께 다시 읽습니다.
      // 이걸 빼면 명단은 바뀌었는데 "학생 0명"이 그대로 남습니다.
      onChanged?.();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "저장하지 못했습니다.");
    } finally {
      setBusy(false);
    }
  }

  const loadCandidates = useCallback(async ({ search, page: candidatePage, signal }: { search: string; page: number; signal: AbortSignal }): Promise<SelectableListPage> => {
    const query = new URLSearchParams({ type: "student", q: search, page: String(candidatePage) });
    if (classFilter) query.set("classId", classFilter);
    const data = await readJson(await fetch(`/api/subjects/${subjectId}/candidates?${query}`, { cache: "no-store", signal })) as unknown as {
      students: RosterStudent[]; totalCount: number; page: number; pageSize: number; truncated: boolean;
    };
    return {
      items: data.students.map((student) => ({
        id: student.id,
        title: student.name || student.loginId || "학생",
        meta: [student.gradeName, student.className, student.studentNumber !== null ? `${student.studentNumber}번` : null].filter(Boolean).join(" · ") || null,
      })),
      totalCount: data.totalCount,
      page: data.page,
      pageSize: data.pageSize,
      truncated: data.truncated,
    };
  }, [subjectId, classFilter]);

  const linkable = useMemo(() => roster?.linkableGroups ?? [], [roster]);
  const linked = useMemo(() => roster?.groups ?? [], [roster]);
  const totalPages = roster ? Math.max(1, Math.ceil(roster.totalCount / roster.pageSize)) : 1;
  // 학급 필터 선택지는 "이미 연결된 반 + 연결 가능한 반"입니다. 연결된 반도 남겨 두는 이유는
  // 그 반에서 개별로 빠진 학생을 다시 찾을 때 필요해서입니다.
  const classOptions = useMemo(() => [...linked, ...linkable], [linked, linkable]);

  return (
    <div className="course-roster">
      {error ? <InlineNotice tone="error">{error}</InlineNotice> : null}
      {notice ? <InlineNotice tone="success">{notice}</InlineNotice> : null}

      <div className={editable ? "course-roster-columns" : undefined}>
      {editable ? (
        <section className="course-groups">
          <header className="course-picker-head">
            <div>
              <b>연결된 학급</b>
              <small>반 명단이 바뀌면 이 교과목 명단도 자동으로 따라옵니다.</small>
            </div>
          </header>
          {linked.length ? (
            <ul className="course-group-list">
              {linked.map((group) => (
                <li key={group.id}>
                  <span className="course-group-chip"><Link2 size={13} aria-hidden />{groupLabel(group)}<small>{group.studentCount}명</small></span>
                  <span className="course-group-actions">
                    <button
                      type="button"
                      className="button ghost small"
                      disabled={busy}
                      title="지금 명단을 개별 배정으로 복사하고 연결은 끊습니다. 이후 반 변경을 따라가지 않습니다."
                      onClick={() => void mutate({ expandGroupIds: [group.id], groups: { remove: [group.id] } }, "명단을 복사했습니다.")}
                    >
                      <UserPlus size={14} />학생 개별 추가
                    </button>
                    <button
                      type="button"
                      className="button ghost small"
                      disabled={busy}
                      onClick={async () => {
                        const ok = await dialog.confirm({
                          title: `'${groupLabel(group)}' 연결을 끊을까요?`,
                          description: "이 반을 통해 들어온 학생은 명단에서 빠집니다. 개별로도 배정된 학생은 남습니다.",
                          danger: true,
                          confirmLabel: "연결 끊기",
                        });
                        if (ok) void mutate({ groups: { remove: [group.id] } }, "학급 연결을 끊었습니다.");
                      }}
                    >
                      <Link2Off size={14} />연결 끊기
                    </button>
                  </span>
                </li>
              ))}
            </ul>
          ) : <p className="course-picker-empty">연결된 학급이 없습니다. 아래에서 반을 통째로 연결할 수 있어요.</p>}

          {/* 학급은 몇 개든 연결할 수 있습니다. 예전에는 <select> 하나로 한 번에 하나씩만 고를 수
              있었고, 남은 후보가 없으면 컨트롤이 통째로 사라져서 "학급은 하나만 연결되는구나"로
              읽혔습니다. 여러 반을 담당하는 교사가 흔하므로 체크해서 한 번에 거는 방식으로
              바꿉니다. 같은 체크 목록으로 "학생 개별 추가"(연결 없이 지금 명단만 복사)와
              "학급 연결"(반이 바뀌면 계속 따라옴) 둘 중 원하는 처리를 고를 수 있습니다. */}
          <div className="course-group-add">
            <div className="course-picker-head">
              <div>
                <b>학급 연결하기</b>
                <small>여러 반을 한 번에 고를 수 있습니다.</small>
              </div>
            </div>
            {/* 후보가 없어도 컨트롤 자체는 숨기지 않습니다 — emptyLabel이 이유를 밝히고, 아래
                적용 버튼은 선택 0개라 자연히 비활성 상태로 남습니다. 사라지면 "더는 안 되는구나"로 읽힙니다. */}
            <SelectableList
              items={linkable.map((group) => ({
                id: group.id,
                title: groupLabel(group),
                meta: [group.schoolName, `학생 ${group.studentCount}명`].filter(Boolean).join(" · "),
              }))}
              selected={pickedGroups}
              onSelectionChange={(next) => setPickedGroups(next)}
              busy={busy}
              unitLabel="학급"
              ariaLabel="연결할 학급 선택"
              emptyLabel={linked.length > 0 ? "이 학교의 학급을 모두 연결했습니다." : "연결할 수 있는 학급이 없습니다. 관리자 센터의 소속 관리에서 학급을 먼저 만들어 주세요."}
            />
            <div className="course-picker-apply">
              <button
                type="button"
                className="button ghost"
                disabled={busy || pickedGroups.size === 0}
                title="연결하지 않고 지금 명단만 개별 배정으로 넣습니다. 이후 반 변경은 따라가지 않습니다."
                aria-label={pickedGroups.size > 0 ? `선택한 ${pickedGroups.size}개 학급 학생 개별 추가` : "선택한 학급 학생 개별 추가"}
                onClick={() => void mutate({ expandGroupIds: [...pickedGroups] }, "학생을 개별 배정으로 추가했습니다.")}
              >
                {busy ? <LoaderCircle size={15} className="spin" /> : <UserPlus size={15} />}
                개별 추가
                <span className="course-action-count" aria-hidden>{pickedGroups.size}</span>
              </button>
              <button
                type="button"
                className="button primary"
                disabled={busy || pickedGroups.size === 0}
                aria-label={pickedGroups.size > 0 ? `선택한 ${pickedGroups.size}개 학급 연결` : "선택한 학급 연결"}
                onClick={() => void mutate({ groups: { add: [...pickedGroups] } }, `학급 ${pickedGroups.size}개를 연결했습니다.`)}
              >
                {busy ? <LoaderCircle size={15} className="spin" /> : <Link2 size={15} />}
                학급 연결
                <span className="course-action-count" aria-hidden>{pickedGroups.size}</span>
              </button>
            </div>
          </div>
        </section>
      ) : null}

      <section className="course-roster-list">
        <header className="course-picker-head">
          <div>
            <b>명단</b>
            <small>개별 배정과 연결 학급을 합친 실제 인원입니다.</small>
          </div>
          <span className="course-picker-count">{roster ? `${roster.totalCount.toLocaleString("ko")}명` : "…"}</span>
        </header>
        {roster === null ? (
          <p className="course-picker-empty"><LoaderCircle size={14} className="spin" aria-hidden /> 불러오는 중…</p>
        ) : roster.students.length === 0 ? (
          <p className="course-picker-empty">아직 배정된 학생이 없습니다.</p>
        ) : (
          <ul className="course-picker-list">
            {roster.students.map((student) => (
              <li key={student.id}>
                <div className="course-picker-row" data-static="true">
                  <span className="course-picker-row-copy">
                    <b>{student.name || student.loginId || "학생"}</b>
                    <small>{[student.gradeName, student.className, student.studentNumber !== null ? `${student.studentNumber}번` : null].filter(Boolean).join(" · ")}</small>
                  </span>
                  {student.sources.includes("GROUP")
                    ? <span className="course-source-badge" title="연결된 학급을 통해 들어왔습니다. 개별로는 뺄 수 없어요."><Link2 size={12} aria-hidden />학급</span>
                    : <span className="course-source-badge" data-direct="true"><UserPlus size={12} aria-hidden />개별</span>}
                  {editable && student.sources.includes("DIRECT") ? (
                    <button
                      type="button"
                      className="icon-button small text-danger"
                      disabled={busy}
                      aria-label={`${student.name ?? "학생"} 배정 해제`}
                      onClick={() => void mutate({ students: { remove: [student.id] } }, "학생을 명단에서 뺐습니다.")}
                    >
                      <Trash2 size={14} />
                    </button>
                  ) : null}
                </div>
              </li>
            ))}
          </ul>
        )}
        {totalPages > 1 ? (
          <nav className="course-picker-pager" aria-label="명단 페이지">
            <button type="button" className="icon-button small" onClick={() => setPage((value) => Math.max(1, value - 1))} disabled={page <= 1} aria-label="이전 페이지"><ChevronLeft size={15} /></button>
            <span>{page} / {totalPages}</span>
            <button type="button" className="icon-button small" onClick={() => setPage((value) => Math.min(totalPages, value + 1))} disabled={page >= totalPages} aria-label="다음 페이지"><ChevronRight size={15} /></button>
          </nav>
        ) : null}
      </section>
      </div>

      {editable ? (
        <>
          <PagedSelectableList
            title="학생 개별 추가"
            description="이름·아이디·출석번호로 찾을 수 있습니다."
            emptyLabel="조건에 맞는 학생이 없습니다."
            searchPlaceholder="이름, 아이디 또는 번호"
            unitLabel="학생"
            unitSuffix="명"
            load={loadCandidates}
            selected={picked}
            onSelectionChange={(next) => setPicked(next)}
            reloadKey={reloadKey}
            busy={busy}
            deferLoad
            ready={classFilter !== ""}
            idleLabel="학급을 선택하면 그 반 학생이 표시됩니다. 이름·아이디로 검색할 수도 있어요."
            filters={
              <label className="select-filter">
                <span className="sr-only">학급으로 좁히기</span>
                <select value={classFilter} onChange={(event) => setClassFilter(event.target.value)}>
                  <option value="">학급 선택</option>
                  {classOptions.map((group) => <option key={group.id} value={group.id}>{groupLabel(group)}</option>)}
                </select>
              </label>
            }
          />
          <div className="course-picker-apply">
            <button
              type="button"
              className="button primary"
              disabled={busy || picked.size === 0}
              aria-label={picked.size > 0 ? `선택한 학생 ${picked.size}명 추가` : "선택한 학생 추가"}
              onClick={() => void mutate({ students: { add: [...picked] } }, `${picked.size}명을 배정했습니다.`)}
            >
              {busy ? <LoaderCircle size={15} className="spin" /> : <Users size={15} />}
              학생 추가
              <span className="course-action-count" aria-hidden>{picked.size}</span>
            </button>
          </div>
        </>
      ) : null}
    </div>
  );
}
