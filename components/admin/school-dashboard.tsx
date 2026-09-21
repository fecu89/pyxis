"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowRight, Building2, GraduationCap, LayoutDashboard, LoaderCircle, School, Settings2, Users } from "lucide-react";
import type { SchoolDirectoryItem } from "@/components/admin/types";

const levelLabels = { ELEMENTARY: "초등학교", MIDDLE: "중학교", HIGH: "고등학교" } as const;
const operatingLabels = { OPERATING: "운영 중", PLANNED: "운영 예정", INACTIVE: "운영 중지" } as const;

async function responseJson(response: Response) {
  const result = await response.json().catch(() => ({ error: "서버 응답을 확인하지 못했습니다." }));
  if (!response.ok) throw new Error(result.error || "요청을 처리하지 못했습니다.");
  return result;
}

function SchoolProfile({ school, canEdit, onChanged }: { school: SchoolDirectoryItem; canEdit: boolean; onChanged: () => void }) {
  const [code, setCode] = useState(school.code ?? "");
  const [level, setLevel] = useState(school.level);
  const [district, setDistrict] = useState(school.district ?? "");
  const [operatingStatus, setOperatingStatus] = useState(school.operatingStatus);
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState("");
  const dirty = code.trim().toUpperCase() !== (school.code ?? "")
    || level !== school.level
    || district.trim() !== (school.district ?? "")
    || operatingStatus !== school.operatingStatus;

  async function save() {
    if (!dirty || pending) return;
    setPending(true);
    setMessage("");
    try {
      await responseJson(await fetch(`/api/admin/schools/${school.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code: code.trim() || null, level, district: district.trim() || null, operatingStatus }),
      }));
      setMessage("학교 정보를 저장했습니다.");
      onChanged();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "학교 정보를 저장하지 못했습니다.");
    } finally {
      setPending(false);
    }
  }

  return (
    <section className="school-dashboard-profile">
      <header><div><span>학교 정보</span><h3>{school.name}</h3></div><em data-status={school.operatingStatus.toLowerCase()}>{operatingLabels[school.operatingStatus]}</em></header>
      <div className="school-dashboard-fields">
        <label><span>학교 코드</span>{canEdit ? <input value={code} onChange={(event) => setCode(event.target.value.toUpperCase())} maxLength={20} placeholder="예: CH" disabled={pending} /> : <b>{school.code || "미지정"}</b>}</label>
        <label><span>급별</span>{canEdit ? <select value={level} onChange={(event) => setLevel(event.target.value as typeof level)} disabled={pending}>{Object.entries(levelLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select> : <b>{levelLabels[school.level]}</b>}</label>
        <label><span>지역</span>{canEdit ? <input value={district} onChange={(event) => setDistrict(event.target.value)} maxLength={100} placeholder="예: 부산광역시 영도구" disabled={pending} /> : <b>{school.district || "미지정"}</b>}</label>
        <label><span>운영 상태</span>{canEdit ? <select value={operatingStatus} onChange={(event) => setOperatingStatus(event.target.value as typeof operatingStatus)} disabled={pending}>{Object.entries(operatingLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select> : <b>{operatingLabels[school.operatingStatus]}</b>}</label>
      </div>
      {canEdit ? <button type="button" className="button soft" onClick={() => void save()} disabled={!dirty || pending}>{pending ? <LoaderCircle size={14} className="spin" /> : <Settings2 size={14} />}학교 정보 저장</button> : null}
      {message ? <p className="school-dashboard-message" role="status">{message}</p> : null}
    </section>
  );
}

export function SchoolDashboard({ schools, canEditSchoolProfile, canManageRoster, onOpenStudents, onOpenOrganizations, onOpenRoster, onChanged }: {
  schools: SchoolDirectoryItem[];
  canEditSchoolProfile: boolean;
  canManageRoster: boolean;
  onOpenStudents: (schoolId?: string) => void;
  onOpenOrganizations: () => void;
  onOpenRoster: () => void;
  onChanged: () => void;
}) {
  const router = useRouter();
  const [schoolId, setSchoolId] = useState(schools.length === 1 ? schools[0]?.id ?? "" : "all");
  const activeSchoolId = schoolId === "all" || schools.some((school) => school.id === schoolId)
    ? schoolId
    : schools.length === 1 ? schools[0]?.id ?? "all" : "all";
  const scopedSchools = useMemo(() => activeSchoolId === "all" ? schools : schools.filter((school) => school.id === activeSchoolId), [activeSchoolId, schools]);
  const selectedSchool = scopedSchools.length === 1 ? scopedSchools[0] : null;
  const totals = scopedSchools.reduce((result, school) => ({
    students: result.students + school.studentCount,
    teachers: result.teachers + school.teacherCount,
    classes: result.classes + school.groups.filter((group) => group.type === "CLASS").length,
    unnumbered: result.unnumbered + school.unnumberedStudentCount,
    unassigned: result.unassigned + school.unassignedStudentCount,
  }), { students: 0, teachers: 0, classes: 0, unnumbered: 0, unassigned: 0 });
  const cleanupCount = totals.unnumbered + totals.unassigned;

  function refresh() {
    router.refresh();
    onChanged();
  }

  return (
    <section className="admin-panel school-dashboard" role="tabpanel">
      <header className="admin-panel-header school-dashboard-header">
        <div><span className="admin-kicker">SCHOOL OVERVIEW</span><h2>학교 대시보드</h2><p>학교별 학생·교사·학급 현황과 소속 정리가 필요한 항목을 확인합니다.</p></div>
        {schools.length > 1 ? <label className="school-dashboard-scope"><span>조회 학교</span><select value={activeSchoolId} onChange={(event) => setSchoolId(event.target.value)}><option value="all">전체 학교</option>{schools.map((school) => <option key={school.id} value={school.id}>{school.name}</option>)}</select></label> : null}
      </header>

      <div className="school-dashboard-body">
        <div className="school-dashboard-metrics">
          <article><span><GraduationCap size={17} /></span><div><small>학생</small><b>{totals.students}</b></div></article>
          <article><span><Users size={17} /></span><div><small>교사</small><b>{totals.teachers}</b></div></article>
          <article><span><School size={17} /></span><div><small>학급</small><b>{totals.classes}</b></div></article>
          <article data-alert={cleanupCount > 0}><span><LayoutDashboard size={17} /></span><div><small>소속 정리 필요</small><b>{cleanupCount}</b></div></article>
        </div>

        <div className="school-dashboard-grid">
          <section className="school-dashboard-tasks">
            <header><div><span>CHECKLIST</span><h3>정리할 항목</h3></div><em>{cleanupCount}건</em></header>
            <button type="button" onClick={() => onOpenStudents(selectedSchool?.id)}><span><b>번호 미지정 학생</b><small>사용자 관리에서 학생 번호를 지정하세요.</small></span><em>{totals.unnumbered}</em><ArrowRight size={15} /></button>
            <button type="button" onClick={() => onOpenStudents(selectedSchool?.id)}><span><b>학급 미배정 학생</b><small>학생의 학교와 반 소속을 확인하세요.</small></span><em>{totals.unassigned}</em><ArrowRight size={15} /></button>
          </section>

          <section className="school-dashboard-actions">
            <header><span>QUICK ACTIONS</span><h3>빠른 작업</h3></header>
            <button type="button" onClick={() => onOpenStudents(selectedSchool?.id)}><span><Users size={17} /></span><div><b>학생 명부</b><small>학생의 반과 번호를 관리합니다.</small></div><ArrowRight size={15} /></button>
            <button type="button" onClick={onOpenOrganizations}><span><Building2 size={17} /></span><div><b>소속 관리</b><small>학급·부서와 대표교사를 관리합니다.</small></div><ArrowRight size={15} /></button>
            {canManageRoster ? <button type="button" onClick={onOpenRoster}><span><GraduationCap size={17} /></span><div><b>학생 계정 발급</b><small>Excel 명단으로 학생 계정을 만듭니다.</small></div><ArrowRight size={15} /></button> : null}
          </section>
        </div>

        {selectedSchool ? <SchoolProfile key={`school-profile-${selectedSchool.id}`} school={selectedSchool} canEdit={canEditSchoolProfile} onChanged={refresh} /> : (
          <section className="school-dashboard-summary">
            <header><span>SCHOOLS</span><h3>학교별 현황</h3></header>
            <div>{scopedSchools.map((school) => <button type="button" key={school.id} onClick={() => setSchoolId(school.id)}><span><b>{school.name}</b><small>{school.code || "코드 미지정"} · {levelLabels[school.level]}{school.district ? ` · ${school.district}` : ""}</small></span><em>{school.studentCount}명</em><ArrowRight size={14} /></button>)}</div>
          </section>
        )}
      </div>
    </section>
  );
}
