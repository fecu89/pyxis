"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import { Search, Briefcase, Building2, ChevronDown, CornerDownRight, GraduationCap, LoaderCircle, Pencil, Plus, ShieldCheck, Trash2, UserRoundCog, Users, X } from "lucide-react";
import { GroupMemberDisclosure } from "@/components/admin/group-member-disclosure";
import { AdminPagination } from "@/components/admin/shared/admin-pagination";
import type { SchoolManagementItem } from "@/components/admin/types";
import { useConfirm } from "@/components/ui/app-dialog";

type SchoolGroup = SchoolManagementItem["groups"][number];
type SchoolTeacher = SchoolManagementItem["teachers"][number];

async function responseJson(response: Response) {
  const result = await response.json().catch(() => ({ error: "서버 응답을 확인하지 못했습니다." }));
  if (!response.ok) throw new Error(result.error || "요청을 처리하지 못했습니다.");
  return result;
}

// 한글 이름 목록에서 사람을 찾을 때 가장 빠른 입력은 초성입니다("ㄱㅎㄴ" → 김하늘).
// 교사가 수십~수백 명인 학교에서 <select>를 훑는 것보다 훨씬 빨라 검색 입력으로 바꿨습니다.
const CHOSEONG = ["ㄱ", "ㄲ", "ㄴ", "ㄷ", "ㄸ", "ㄹ", "ㅁ", "ㅂ", "ㅃ", "ㅅ", "ㅆ", "ㅇ", "ㅈ", "ㅉ", "ㅊ", "ㅋ", "ㅌ", "ㅍ", "ㅎ"];

function toChoseong(value: string) {
  return Array.from(value).map((character) => {
    const code = character.charCodeAt(0);
    // 완성형 한글(가~힣)만 초성으로 바꾸고 나머지는 그대로 둡니다.
    if (code >= 0xac00 && code <= 0xd7a3) return CHOSEONG[Math.floor((code - 0xac00) / 588)];
    return character;
  }).join("");
}

function matchesTeacher(teacher: SchoolTeacher, query: string) {
  const haystack = `${teacher.name ?? ""} ${teacher.departmentName ?? ""}`.toLocaleLowerCase("ko-KR");
  if (haystack.includes(query.toLocaleLowerCase("ko-KR"))) return true;
  // 자음만 입력했을 때만 초성으로 비교합니다. 일반 글자까지 초성으로 바꿔 비교하면
  // "김"이 ㄱ으로 축약돼 ㄱ으로 시작하는 모든 이름에 걸려 버립니다.
  if (/^[ㄱ-ㅎ]+$/u.test(query)) return toChoseong(`${teacher.name ?? ""}`).includes(query);
  return false;
}

function TeacherCombobox({ teachers, value, onChange, disabled, inputId }: {
  teachers: SchoolTeacher[];
  value: SchoolTeacher | null;
  onChange: (teacher: SchoolTeacher | null) => void;
  disabled: boolean;
  inputId: string;
}) {
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(0);
  const blurTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => () => {
    if (blurTimer.current) clearTimeout(blurTimer.current);
  }, []);

  const trimmed = query.trim();
  const matches = trimmed ? teachers.filter((teacher) => matchesTeacher(teacher, trimmed)) : teachers;
  const visible = matches.slice(0, 30);
  const activeId = visible[activeIndex] ? `${inputId}-option-${visible[activeIndex].id}` : undefined;

  function select(teacher: SchoolTeacher) {
    onChange(teacher);
    setQuery("");
    setOpen(false);
    setActiveIndex(0);
  }

  function onKeyDown(event: React.KeyboardEvent<HTMLInputElement>) {
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      if (!open) { setOpen(true); return; }
      setActiveIndex((current) => {
        if (!visible.length) return 0;
        const next = event.key === "ArrowDown" ? current + 1 : current - 1;
        return (next + visible.length) % visible.length;
      });
      return;
    }
    if (event.key === "Enter" && open && visible[activeIndex]) {
      event.preventDefault();
      select(visible[activeIndex]);
      return;
    }
    if (event.key === "Escape") { setOpen(false); setActiveIndex(0); }
  }

  // 선택을 끝냈으면 입력창 대신 고른 교사를 칩으로 보여 줍니다. 무엇을 골랐는지가
  // 입력값이 아니라 결과로 보여야 "지정" 버튼을 누르기 전에 확인할 수 있습니다.
  if (value) {
    return (
      <div className="teacher-combobox-selected">
        <span className="school-representative-avatar">{(value.name || "?")[0]}</span>
        <span><b>{value.name || "이름 없음"}</b><small>{value.departmentName || "부서 미지정"}</small></span>
        <button type="button" className="icon-button small" onClick={() => onChange(null)} disabled={disabled} aria-label="선택한 교사 지우기"><X size={13} /></button>
      </div>
    );
  }

  return (
    <div className="teacher-combobox">
      <input
        id={inputId}
        role="combobox"
        aria-expanded={open}
        aria-controls={`${inputId}-listbox`}
        aria-activedescendant={activeId}
        aria-autocomplete="list"
        autoComplete="off"
        value={query}
        disabled={disabled || teachers.length === 0}
        placeholder={teachers.length ? "이름·부서 검색 (초성 가능)" : "지정할 수 있는 교사가 없습니다"}
        onChange={(event) => { setQuery(event.target.value); setOpen(true); setActiveIndex(0); }}
        onFocus={() => setOpen(true)}
        // 목록 항목을 누르는 순간 blur가 먼저 일어나 클릭이 사라지므로 한 틱 늦춥니다.
        onBlur={() => { blurTimer.current = setTimeout(() => setOpen(false), 120); }}
        onKeyDown={onKeyDown}
      />
      {open && teachers.length > 0 ? (
        <ul className="teacher-combobox-list" id={`${inputId}-listbox`} role="listbox" onMouseDown={() => { if (blurTimer.current) clearTimeout(blurTimer.current); }}>
          {visible.length ? visible.map((teacher, index) => (
            <li key={teacher.id}>
              <button
                type="button"
                id={`${inputId}-option-${teacher.id}`}
                role="option"
                aria-selected={index === activeIndex}
                data-active={index === activeIndex ? "true" : undefined}
                onMouseEnter={() => setActiveIndex(index)}
                onClick={() => select(teacher)}
              >
                <span className="school-representative-avatar">{(teacher.name || "?")[0]}</span>
                <span><b>{teacher.name || "이름 없음"}</b><small>{teacher.departmentName || "부서 미지정"}</small></span>
              </button>
            </li>
          )) : <li className="teacher-combobox-empty">일치하는 교사가 없습니다.</li>}
          {matches.length > visible.length ? <li className="teacher-combobox-empty">{matches.length - visible.length}명 더 있습니다. 검색어를 좁혀 주세요.</li> : null}
        </ul>
      ) : null}
    </div>
  );
}

function SchoolRepresentativeManager({ schoolId, teachers, canManage, onChanged }: {
  schoolId: string;
  teachers: SchoolTeacher[];
  canManage: boolean;
  onChanged: () => void;
}) {
  const confirm = useConfirm();
  const representatives = teachers.filter((teacher) => teacher.isSchoolRepresentative);
  const candidates = teachers.filter((teacher) => !teacher.isSchoolRepresentative);
  const [selected, setSelected] = useState<SchoolTeacher | null>(null);
  const [pendingId, setPendingId] = useState<string | null>(null);
  const [message, setMessage] = useState("");

  async function changeRepresentative(target: SchoolTeacher, enabled: boolean) {
    if (!(await confirm({
      description: `${target.name || "이 교사"}님을 학교 대표교사로 ${enabled ? "지정" : "해제"}할까요?`,
      confirmLabel: enabled ? "대표 지정" : "대표 해제",
      danger: !enabled,
    }))) return;
    setPendingId(target.id);
    setMessage("");
    try {
      await responseJson(await fetch(`/api/admin/users/${target.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          isSchoolRepresentative: enabled,
          reason: `관리자 소속 관리에서 학교 대표교사 ${enabled ? "지정" : "해제"}`,
        }),
      }));
      if (enabled) setSelected(null);
      setMessage(enabled ? "학교 대표교사를 지정했습니다." : "대표교사 지정을 해제했습니다. 이 학교는 대표교사 미지정 상태입니다.");
      onChanged();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "대표교사 지정을 변경하지 못했습니다.");
    } finally {
      setPendingId(null);
    }
  }

  return (
    <section className="school-representative-manager" aria-labelledby={`${schoolId}-representative-title`}>
      <header>
        <span><ShieldCheck size={16} /></span>
        <div><h3 id={`${schoolId}-representative-title`}>학교 대표교사</h3><p>학생 계정 발급과 학교 소속 관리를 맡을 교사를 지정합니다. 없어도 됩니다.</p></div>
        <em>{representatives.length ? `${representatives.length}명` : "미지정"}</em>
      </header>
      <div className="school-representative-list">
        {representatives.length ? representatives.map((teacher) => (
          <div key={teacher.id}>
            <span className="school-representative-avatar">{(teacher.name || "?")[0]}</span>
            <span><b>{teacher.name || "이름 없음"}</b><small>{teacher.departmentName || "부서 미지정"}</small></span>
            <em><ShieldCheck size={11} />대표교사</em>
            {canManage ? <button type="button" className="icon-button small" onClick={() => void changeRepresentative(teacher, false)} disabled={pendingId !== null} aria-label={`${teacher.name || "교사"} 대표교사 해제`}>{pendingId === teacher.id ? <LoaderCircle size={14} className="spin" /> : <X size={14} />}</button> : null}
          </div>
        )) : <p>지정된 학교 대표교사가 없습니다(미지정). 이 상태로 두어도 되며, 학생 계정 발급·소속 관리는 전체관리자가 대신합니다.</p>}
      </div>
      {canManage ? (
        <div className="school-representative-controls">
          <label htmlFor={`${schoolId}-representative-search`}><span>대표로 지정할 교사</span></label>
          <TeacherCombobox teachers={candidates} value={selected} onChange={setSelected} disabled={pendingId !== null} inputId={`${schoolId}-representative-search`} />
          <button type="button" className="button soft" onClick={() => selected && void changeRepresentative(selected, true)} disabled={!selected || pendingId !== null}><UserRoundCog size={14} />대표 지정</button>
        </div>
      ) : null}
      {message ? <p className="school-representative-message" role="status">{message}</p> : null}
    </section>
  );
}

function DepartmentRow({ schoolId, group, canManageGroup, onChanged }: { schoolId: string; group: SchoolGroup; canManageGroup: boolean; onChanged: () => void }) {
  const confirm = useConfirm();
  const [name, setName] = useState(group.name);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const dirty = name.trim() !== group.name;

  async function save() {
    if (!dirty || pending) return;
    setPending(true);
    setError("");
    try {
      await responseJson(await fetch(`/api/admin/schools/${schoolId}/groups/${group.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: name.trim() }),
      }));
      onChanged();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "변경하지 못했습니다.");
    } finally {
      setPending(false);
    }
  }

  async function remove() {
    if (!(await confirm({ description: `'${group.name}' 부서를 삭제할까요?${group.userCount > 0 ? `\n\n${group.userCount}명의 소속 정보가 초기화됩니다.` : ""}`, confirmLabel: "삭제", danger: true }))) return;
    setPending(true);
    setError("");
    try {
      await responseJson(await fetch(`/api/admin/schools/${schoolId}/groups/${group.id}`, { method: "DELETE" }));
      onChanged();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "삭제하지 못했습니다.");
      setPending(false);
    }
  }

  return (
    <li className="school-group-row">
      {canManageGroup
        ? <input value={name} onChange={(event) => setName(event.target.value)} disabled={pending} maxLength={100} aria-label={`${group.name} 부서 이름`} />
        : <span className="school-group-name"><Briefcase size={13} />{group.name}</span>}
      <GroupMemberDisclosure schoolId={schoolId} groupId={group.id} groupName={group.name} groupType={group.type} userCount={group.userCount} />
      {canManageGroup ? <button type="button" className="icon-button small" onClick={save} disabled={!dirty || pending} aria-label={`${group.name} 저장`}>{pending ? <LoaderCircle size={14} className="spin" /> : <Pencil size={14} />}</button> : null}
      {canManageGroup ? <button type="button" className="icon-button small" onClick={remove} disabled={pending || group.isDefault} title={group.isDefault ? "서비스 초기 소속 데이터로 보호됩니다." : undefined} aria-label={group.isDefault ? "기본 부서 삭제 불가" : "부서 삭제"}><Trash2 size={14} /></button> : null}
      {error ? <small className="form-error compact">{error}</small> : null}
    </li>
  );
}

function ClassRow({ schoolId, group, canManageGroup, legacy = false, onChanged }: { schoolId: string; group: SchoolGroup; canManageGroup: boolean; legacy?: boolean; onChanged: () => void }) {
  const confirm = useConfirm();
  const [grade, setGrade] = useState(group.grade ?? 1);
  const [classNumber, setClassNumber] = useState(group.classNumber ?? 1);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const dirty = classNumber !== group.classNumber || (legacy && grade !== group.grade);

  async function save() {
    if (!dirty || pending) return;
    setPending(true);
    setError("");
    try {
      await responseJson(await fetch(`/api/admin/schools/${schoolId}/groups/${group.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(legacy ? { grade, classNumber } : { classNumber }),
      }));
      onChanged();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "학급을 변경하지 못했습니다.");
    } finally {
      setPending(false);
    }
  }

  async function remove() {
    if (!(await confirm({ description: `'${group.name}' 학급을 삭제할까요?${group.userCount > 0 ? `\n\n${group.userCount}명의 소속 정보가 초기화됩니다.` : ""}`, confirmLabel: "삭제", danger: true }))) return;
    setPending(true);
    setError("");
    try {
      await responseJson(await fetch(`/api/admin/schools/${schoolId}/groups/${group.id}`, { method: "DELETE" }));
      onChanged();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "학급을 삭제하지 못했습니다.");
      setPending(false);
    }
  }

  return (
    <li className="school-class-row">
      <div className="school-class-number-fields" data-legacy={legacy}>
        <span className="school-hierarchy-branch" aria-hidden><CornerDownRight size={14} /></span>
        {canManageGroup ? (
          <>
            {legacy ? <label><span>학년</span><input type="number" min={1} max={12} value={grade} onChange={(event) => setGrade(Number(event.target.value))} disabled={pending} /></label> : null}
            <label><span>반</span><input type="number" min={1} max={99} value={classNumber} onChange={(event) => setClassNumber(Number(event.target.value))} disabled={pending} /></label>
          </>
        ) : <b className="school-class-name">{group.classNumber ? `${group.classNumber}반` : group.name}</b>}
      </div>
      <GroupMemberDisclosure schoolId={schoolId} groupId={group.id} groupName={group.name} groupType={group.type} userCount={group.userCount} />
      {canManageGroup ? <button type="button" className="icon-button small" onClick={save} disabled={!dirty || pending} aria-label={`${group.name} 저장`}>{pending ? <LoaderCircle size={14} className="spin" /> : <Pencil size={14} />}</button> : null}
      {canManageGroup ? <button type="button" className="icon-button small" onClick={remove} disabled={pending || group.isDefault} title={group.isDefault ? "서비스 초기 소속 데이터로 보호됩니다." : undefined} aria-label={group.isDefault ? "기본 학급 삭제 불가" : `${group.name} 삭제`}><Trash2 size={14} /></button> : null}
      {error ? <small className="form-error compact">{error}</small> : null}
    </li>
  );
}

function AddClassForm({ schoolId, onChanged }: { schoolId: string; onChanged: () => void }) {
  const [grade, setGrade] = useState(1);
  const [classNumber, setClassNumber] = useState(1);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPending(true);
    setError("");
    try {
      await responseJson(await fetch(`/api/admin/schools/${schoolId}/groups`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ type: "CLASS", grade, classNumber }),
      }));
      onChanged();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "학급을 추가하지 못했습니다.");
    } finally {
      setPending(false);
    }
  }

  return (
    <form className="school-class-add" onSubmit={submit}>
      <label><span>학년</span><input type="number" min={1} max={12} value={grade} onChange={(event) => setGrade(Number(event.target.value))} disabled={pending} /></label>
      <label><span>반</span><input type="number" min={1} max={99} value={classNumber} onChange={(event) => setClassNumber(Number(event.target.value))} disabled={pending} /></label>
      <button type="submit" className="button soft" disabled={pending}><Plus size={14} />학급 추가</button>
      {error ? <small className="form-error compact">{error}</small> : null}
    </form>
  );
}

function AddDepartmentForm({ schoolId, onChanged }: { schoolId: string; onChanged: () => void }) {
  const [name, setName] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!name.trim()) return;
    setPending(true);
    setError("");
    try {
      await responseJson(await fetch(`/api/admin/schools/${schoolId}/groups`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ type: "DEPARTMENT", name: name.trim() }),
      }));
      setName("");
      onChanged();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "부서를 추가하지 못했습니다.");
    } finally {
      setPending(false);
    }
  }

  return (
    <form className="school-group-add" onSubmit={submit}>
      <input value={name} onChange={(event) => setName(event.target.value)} placeholder="예: 3학년부" maxLength={100} disabled={pending} aria-label="새 교사 부서 이름" />
      <button type="submit" className="button soft" disabled={pending || !name.trim()}><Plus size={14} />부서 추가</button>
      {error ? <small className="form-error compact">{error}</small> : null}
    </form>
  );
}

function ClassSection({ schoolId, groups, canManageGroups, onChanged }: { schoolId: string; groups: SchoolGroup[]; canManageGroups: boolean; onChanged: () => void }) {
  const gradeNumbers = [...new Set(groups.map((group) => group.grade).filter((grade): grade is number => grade !== null))].sort((a, b) => a - b);
  const legacyGroups = groups.filter((group) => group.grade === null || group.classNumber === null);
  const userCount = groups.reduce((count, group) => count + group.userCount, 0);

  return (
    <section className="school-group-section school-class-section" data-type="class" aria-labelledby={`${schoolId}-class-title`}>
      <header className="school-group-section-header">
        <span className="school-group-section-icon"><GraduationCap size={17} /></span>
        <div><h3 id={`${schoolId}-class-title`}>학생 학급</h3><p>학년 아래에 반을 두고 학생을 배정합니다.</p></div>
        <span className="school-group-section-count">{groups.length}개 · {userCount}명</span>
      </header>
      {gradeNumbers.length || legacyGroups.length ? (
        <div className="school-grade-list">
          {gradeNumbers.map((grade) => {
            const classes = groups.filter((group) => group.grade === grade).sort((a, b) => (a.classNumber ?? 0) - (b.classNumber ?? 0));
            return (
              <section className="school-grade-card" key={grade} aria-label={`${grade}학년`}>
                <header><b>{grade}학년</b><span>{classes.length}개 반 · {classes.reduce((sum, item) => sum + item.userCount, 0)}명</span></header>
                <ul>{classes.map((group) => <ClassRow key={group.id} schoolId={schoolId} group={group} canManageGroup={canManageGroups} onChanged={onChanged} />)}</ul>
              </section>
            );
          })}
          {legacyGroups.length ? (
            <section className="school-grade-card legacy" aria-label="학년 미지정 학급">
              <header><b>학년 미지정</b><span>한 번 저장하면 새 계층으로 이동합니다.</span></header>
              <ul>{legacyGroups.map((group) => <ClassRow key={group.id} schoolId={schoolId} group={group} canManageGroup={canManageGroups} legacy onChanged={onChanged} />)}</ul>
            </section>
          ) : null}
        </div>
      ) : <p className="admin-empty compact">등록된 학생 학급이 없습니다.</p>}
      {canManageGroups ? <AddClassForm schoolId={schoolId} onChanged={onChanged} /> : null}
    </section>
  );
}

function DepartmentSection({ schoolId, groups, canManageGroups, onChanged }: { schoolId: string; groups: SchoolGroup[]; canManageGroups: boolean; onChanged: () => void }) {
  const userCount = groups.reduce((count, group) => count + group.userCount, 0);
  return (
    <section className="school-group-section" data-type="department" aria-labelledby={`${schoolId}-department-title`}>
      <header className="school-group-section-header">
        <span className="school-group-section-icon"><Briefcase size={17} /></span>
        <div><h3 id={`${schoolId}-department-title`}>교사 부서</h3><p>교사를 업무 부서 단위로 배정합니다.</p></div>
        <span className="school-group-section-count">{groups.length}개 · {userCount}명</span>
      </header>
      {groups.length
        ? <ul className="school-group-list">{groups.map((group) => <DepartmentRow key={group.id} schoolId={schoolId} group={group} canManageGroup={canManageGroups} onChanged={onChanged} />)}</ul>
        : <p className="admin-empty compact">등록된 교사 부서가 없습니다.</p>}
      {canManageGroups ? <AddDepartmentForm schoolId={schoolId} onChanged={onChanged} /> : null}
    </section>
  );
}

function SchoolRow({ school, expanded, canManageSchoolLevel, canManageSchoolGroups, onToggle, onChanged }: {
  school: SchoolManagementItem;
  expanded: boolean;
  canManageSchoolLevel: boolean;
  canManageSchoolGroups: boolean;
  onToggle: () => void;
  onChanged: () => void;
}) {
  const confirm = useConfirm();
  const [name, setName] = useState(school.name);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const dirty = name.trim() !== school.name;
  const classGroups = school.groups.filter((group) => group.type === "CLASS");
  const departmentGroups = school.groups.filter((group) => group.type === "DEPARTMENT");
  const gradeCount = new Set(classGroups.map((group) => group.grade).filter((grade) => grade !== null)).size;

  async function save() {
    if (!dirty || pending) return;
    setPending(true);
    setError("");
    try {
      await responseJson(await fetch(`/api/admin/schools/${school.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: name.trim() }),
      }));
      onChanged();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "변경하지 못했습니다.");
    } finally {
      setPending(false);
    }
  }

  async function remove() {
    const groupCount = school.groups.length;
    if (!(await confirm({ description: `'${school.name}' 학교를 삭제할까요?${school.userCount > 0 || groupCount > 0 ? `\n\n학급·부서 ${groupCount}개가 함께 삭제되고, ${school.userCount}명의 소속 정보가 초기화됩니다.` : ""}`, confirmLabel: "삭제", danger: true }))) return;
    setPending(true);
    setError("");
    try {
      await responseJson(await fetch(`/api/admin/schools/${school.id}`, { method: "DELETE" }));
      onChanged();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "삭제하지 못했습니다.");
      setPending(false);
    }
  }

  return (
    <li className="school-row-wrap">
      <div className="school-row">
        <button type="button" className="icon-button small" onClick={onToggle} aria-expanded={expanded} aria-label={`${school.name} 소속 목록 ${expanded ? "접기" : "펼치기"}`}><ChevronDown size={16} className={expanded ? "rotated" : ""} /></button>
        <Building2 size={16} />
        {canManageSchoolLevel
          ? <input value={name} onChange={(event) => setName(event.target.value)} disabled={pending} maxLength={100} aria-label={`${school.name} 학교 이름`} />
          : <b className="school-name">{school.name}</b>}
        <span className="school-group-count"><Users size={12} />{school.userCount}명 · {gradeCount}개 학년 · {classGroups.length}개 반 · 교사 부서 {departmentGroups.length}{school.isDefault ? " · 기본" : ""}</span>
        {canManageSchoolLevel ? (
          <>
            <button type="button" className="icon-button small" onClick={save} disabled={!dirty || pending} aria-label={`${school.name} 학교 이름 저장`}>{pending ? <LoaderCircle size={14} className="spin" /> : <Pencil size={14} />}</button>
            <button type="button" className="icon-button small" onClick={remove} disabled={pending || school.isDefault} title={school.isDefault ? "서비스 초기 학교 데이터로 보호됩니다." : undefined} aria-label={school.isDefault ? "기본 학교는 삭제할 수 없음" : "학교 삭제"}><Trash2 size={14} /></button>
          </>
        ) : null}
      </div>
      {error ? <p className="form-error compact">{error}</p> : null}
      {expanded ? (
        <div className="school-groups">
          <SchoolRepresentativeManager schoolId={school.id} teachers={school.teachers} canManage={canManageSchoolLevel} onChanged={onChanged} />
          <div className="school-group-sections">
            <ClassSection schoolId={school.id} groups={classGroups} canManageGroups={canManageSchoolGroups} onChanged={onChanged} />
            <DepartmentSection schoolId={school.id} groups={departmentGroups} canManageGroups={canManageSchoolGroups} onChanged={onChanged} />
          </div>
        </div>
      ) : null}
    </li>
  );
}

export function SchoolManager({ initialSchools, initialTotalCount, initialPage, initialPageSize, canManageSchoolLevel, canManageSchoolGroups, onAuditChanged }: {
  initialSchools: SchoolManagementItem[];
  initialTotalCount: number;
  initialPage: number;
  initialPageSize: number;
  canManageSchoolLevel: boolean;
  canManageSchoolGroups: boolean;
  onAuditChanged?: () => void;
}) {
  const [schools, setSchools] = useState(initialSchools);
  const [totalCount, setTotalCount] = useState(initialTotalCount);
  const [page, setPage] = useState(initialPage);
  const [pageSize, setPageSize] = useState(initialPageSize);
  const [search, setSearch] = useState("");
  const [pending, setPending] = useState(false);
  const [listError, setListError] = useState("");
  const [expandedSchoolId, setExpandedSchoolId] = useState<string | null>(null);
  const [newSchoolName, setNewSchoolName] = useState("");
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState("");
  const listControllerRef = useRef<AbortController | null>(null);

  useEffect(() => () => listControllerRef.current?.abort(), []);

  async function loadSchools(targetPage: number, targetPageSize: number, targetSearch: string) {
    listControllerRef.current?.abort();
    const controller = new AbortController();
    listControllerRef.current = controller;
    setPending(true);
    setListError("");
    try {
      const query = new URLSearchParams({ page: String(targetPage), pageSize: String(targetPageSize) });
      if (targetSearch.trim()) query.set("search", targetSearch.trim());
      const result = await responseJson(await fetch(`/api/admin/schools?${query}`, { cache: "no-store", signal: controller.signal }));
      setSchools(result.schools);
      setTotalCount(result.totalCount);
      setPage(result.page);
      setPageSize(result.pageSize);
    } catch (reason) {
      if (reason instanceof DOMException && reason.name === "AbortError") return;
      setListError(reason instanceof Error ? reason.message : "학교 목록을 불러오지 못했습니다.");
    } finally {
      if (listControllerRef.current === controller) {
        listControllerRef.current = null;
        setPending(false);
      }
    }
  }

  function refresh() {
    void loadSchools(page, pageSize, search);
    onAuditChanged?.();
  }

  // 2글자 이상 입력하고 200ms 동안 멈추면 자동으로 검색합니다. 검색어를 지워 0글자가 되면
  // 바로(디바운스 없이) 전체 목록으로 되돌립니다. 첫 렌더에는 실행하지 않아야 서버가 이미
  // 내려준 첫 페이지를 곧바로 다시 요청하는 낭비가 없습니다.
  const skipNextSearchEffect = useRef(true);
  useEffect(() => {
    if (skipNextSearchEffect.current) { skipNextSearchEffect.current = false; return; }
    const trimmed = search.trim();
    if (trimmed.length === 1) return;
    const delay = trimmed.length === 0 ? 0 : 200;
    const timer = setTimeout(() => { void loadSchools(1, pageSize, trimmed); }, delay);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search]);

  function submitSearch(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    void loadSchools(1, pageSize, search);
  }

  function changePageSize(nextPageSize: number) {
    void loadSchools(1, nextPageSize, search);
  }

  async function createSchool(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!newSchoolName.trim()) return;
    setCreating(true);
    setCreateError("");
    try {
      await responseJson(await fetch("/api/admin/schools", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: newSchoolName.trim() }),
      }));
      setNewSchoolName("");
      void loadSchools(1, pageSize, search);
      onAuditChanged?.();
    } catch (reason) {
      setCreateError(reason instanceof Error ? reason.message : "학교를 추가하지 못했습니다.");
    } finally {
      setCreating(false);
    }
  }

  return (
    <section className="admin-panel school-manager" role="tabpanel">
      <header className="admin-panel-header">
        <div><span className="admin-kicker">ORGANIZATIONS</span><h2>소속 관리</h2><p>{canManageSchoolGroups ? "학교 → 학년 → 반과 교사 부서를 분리해 관리합니다." : "소속 구조를 확인하고 학생 번호를 지정·변경할 수 있습니다."}</p></div>
      </header>
      {canManageSchoolLevel ? (
        <form className="school-add" onSubmit={createSchool}>
          <input value={newSchoolName} onChange={(event) => setNewSchoolName(event.target.value)} placeholder="예: 청학고등학교" maxLength={100} disabled={creating} aria-label="새 학교 이름" />
          <button type="submit" className="button primary" disabled={creating || !newSchoolName.trim()}><Plus size={15} />학교 추가</button>
          {createError ? <small className="form-error compact">{createError}</small> : null}
        </form>
      ) : null}
      <form className="admin-user-search" onSubmit={submitSearch}>
        <div className="admin-search-main">
          <div className="admin-search-field">
            <Search size={17} aria-hidden />
            <label htmlFor="school-search" className="sr-only">학교 이름 또는 코드 검색</label>
            <input id="school-search" type="text" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="학교 이름 또는 코드 검색" autoComplete="off" disabled={pending} />
          </div>
        </div>
      </form>
      {listError ? <p className="admin-global-error" role="alert">{listError}</p> : null}
      {schools.length ? (
        <ul className="school-list">
          {schools.map((school) => (
            <SchoolRow
              key={school.id}
              school={school}
              expanded={expandedSchoolId === school.id}
              canManageSchoolLevel={canManageSchoolLevel}
              canManageSchoolGroups={canManageSchoolGroups}
              onToggle={() => setExpandedSchoolId((current) => current === school.id ? null : school.id)}
              onChanged={refresh}
            />
          ))}
        </ul>
      ) : <p className="admin-empty">{search.trim() ? "검색 조건에 맞는 학교가 없습니다." : "등록된 학교가 없습니다."}</p>}
      <AdminPagination page={page} pageSize={pageSize} totalCount={totalCount} pending={pending} onPageChange={(nextPage) => void loadSchools(nextPage, pageSize, search)} onPageSizeChange={changePageSize} />
    </section>
  );
}
