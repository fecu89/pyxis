"use client";

import { useState, type FormEvent } from "react";
import { CheckCircle2, Download, LoaderCircle, Upload, X } from "lucide-react";
import type { SchoolDirectoryItem } from "@/components/admin/types";

type Preview = {
  studentCount: number;
  schoolCount: number;
  gradeCount: number;
  classCount: number;
  newSchools: string[];
  newGradeCount: number;
  newClassCount: number;
  conflicts: { line: number; loginId: string; reason: string }[];
  sample: {
    line: number;
    schoolName: string;
    grade: number;
    classNumber: number;
    studentNumber: number;
    name: string;
    loginId: string;
  }[];
};

type Credential = {
  schoolName: string;
  grade: number;
  classNumber: number;
  studentNumber: number;
  name: string;
  loginId: string;
  initialPassword: string;
};

async function responseJson(response: Response) {
  const result = await response.json().catch(() => ({ error: "서버 응답을 확인하지 못했습니다." }));
  if (!response.ok) throw new Error(result.error || "학생 명단을 처리하지 못했습니다.");
  return result;
}

function csvCell(value: string | number) {
  const raw = String(value);
  const safe = /^[=+\-@]/u.test(raw) ? `'${raw}` : raw;
  return `"${safe.replace(/"/gu, '""')}"`;
}

export function StudentRosterImport({ schools, onImported }: { schools: SchoolDirectoryItem[]; onImported?: (importedCount: number) => void }) {
  const [file, setFile] = useState<File | null>(null);
  const [prefix, setPrefix] = useState("");
  const [preview, setPreview] = useState<Preview | null>(null);
  const [credentials, setCredentials] = useState<Credential[] | null>(null);
  const [busy, setBusy] = useState<"preview" | "import" | null>(null);
  const [error, setError] = useState("");
  const exampleId = `${prefix.trim().toLocaleLowerCase("en-US") || "ch"}30106`;

  function resetPreview() {
    setPreview(null);
    setCredentials(null);
    setError("");
  }

  async function submit(mode: "preview" | "import") {
    if (!file) {
      setError(".xlsx 학생 명단을 선택해 주세요.");
      return;
    }
    setBusy(mode);
    setError("");
    try {
      const body = new FormData();
      body.set("file", file);
      body.set("prefix", prefix);
      body.set("mode", mode);
      if (mode === "import") body.set("reason", `관리자 학생 명단 일괄 발급 (${preview?.studentCount ?? 0}명)`);
      const result = await responseJson(await fetch("/api/admin/students/import", { method: "POST", body }));
      if (mode === "preview") {
        setPreview(result.preview);
        setCredentials(null);
      } else {
        setCredentials(result.credentials);
        setPreview(null);
        onImported?.(result.importedCount);
      }
    } catch (reasonValue) {
      setError(reasonValue instanceof Error ? reasonValue.message : "학생 명단을 처리하지 못했습니다.");
    } finally {
      setBusy(null);
    }
  }

  function previewSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    void submit("preview");
  }

  function downloadCredentials() {
    if (!credentials?.length) return;
    const rows = [
      ["학교", "학년", "반", "번호", "이름", "로그인 아이디", "초기 비밀번호"],
      ...credentials.map((item) => [item.schoolName, item.grade, item.classNumber, item.studentNumber, item.name, item.loginId, item.initialPassword]),
    ];
    const csv = `\uFEFF${rows.map((row) => row.map(csvCell).join(",")).join("\r\n")}`;
    const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
    const link = document.createElement("a");
    link.href = url;
    link.download = `student-credentials-${new Date().toISOString().slice(0, 10)}.csv`;
    link.click();
    URL.revokeObjectURL(url);
  }

  return (
    <section className="admin-panel student-roster-import" role="tabpanel">
      <header className="admin-panel-header">
        <div><span className="admin-kicker">STUDENT ONBOARDING</span><h2>학생 계정 발급</h2><p>Excel 명단 한 번으로 학교·학년·반과 학생 로그인 계정을 함께 만듭니다.</p></div>
        <span className="student-roster-school-count">현재 학교 {schools.length}개</span>
      </header>
      <div className="student-roster-body">
        <div className="student-roster-guide">
          <span><b>1</b> 양식 작성</span><i />
          <span><b>2</b> 미리보기</span><i />
          <span><b>3</b> 계정 발급</span>
        </div>
        <div className="student-roster-template">
          <span><b>필수 열: 학교, 학년, 반, 번호, 이름</b><small>수식 없이 첫 번째 시트에 최대 500명을 입력해 주세요. 파일은 3MB까지 가능합니다.</small></span>
          <a className="button soft" href="/api/admin/students/import"><Download size={14} />양식 받기</a>
        </div>
        <form className="student-roster-form" onSubmit={previewSubmit}>
          <label className="student-roster-file">
            <span>{file ? <CheckCircle2 size={18} /> : <Upload size={18} />}</span>
            <span><b>{file?.name ?? ".xlsx 파일 선택"}</b><small>{file ? `${Math.max(1, Math.ceil(file.size / 1024))}KB` : "클릭해서 학생 명단을 불러오세요."}</small></span>
            <input type="file" accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" onChange={(event) => { setFile(event.target.files?.[0] ?? null); resetPreview(); }} disabled={busy !== null} />
          </label>
          <label className="student-roster-prefix"><span>아이디 접두어</span><input value={prefix} onChange={(event) => { setPrefix(event.target.value); resetPreview(); }} placeholder="예: ch" pattern="[A-Za-z0-9]{1,10}" title="영문자와 숫자만 입력해 주세요." maxLength={10} autoCapitalize="none" autoComplete="off" spellCheck={false} disabled={busy !== null} /><small>영문자·숫자만 사용 · 3학년 1반 6번 → <b>{exampleId}</b></small></label>
          <button type="submit" className="button primary" disabled={busy !== null || !file || !prefix.trim()}>{busy === "preview" ? <><LoaderCircle size={15} className="spin" />확인 중…</> : "명단 미리보기"}</button>
        </form>

        {preview ? (
          <section className="student-roster-preview" aria-live="polite">
            <header><div><span>등록 전 확인</span><h3>{preview.studentCount}명의 계정을 만들 예정입니다.</h3></div><button type="button" className="icon-button small" onClick={() => setPreview(null)} aria-label="미리보기 닫기"><X size={15} /></button></header>
            <dl>
              <div><dt>학교</dt><dd>{preview.schoolCount}<small>신규 {preview.newSchools.length}</small></dd></div>
              <div><dt>학년</dt><dd>{preview.gradeCount}<small>신규 {preview.newGradeCount}</small></dd></div>
              <div><dt>학급</dt><dd>{preview.classCount}<small>신규 {preview.newClassCount}</small></dd></div>
              <div><dt>학생</dt><dd>{preview.studentCount}<small>신규 계정</small></dd></div>
            </dl>
            {preview.newSchools.length ? <p className="student-roster-note">새 학교: {preview.newSchools.join(", ")}</p> : null}
            {preview.conflicts.length ? (
              <div className="student-roster-conflicts" role="alert"><b>등록할 수 없는 아이디 {preview.conflicts.length}개</b>{preview.conflicts.slice(0, 10).map((item) => <span key={`${item.line}-${item.loginId}`}>{item.line}행 · {item.loginId} · {item.reason}</span>)}</div>
            ) : (
              <div className="student-roster-sample-wrap">
                <table><thead><tr><th>행</th><th>학생</th><th>소속</th><th>로그인 아이디</th></tr></thead><tbody>{preview.sample.map((item) => <tr key={item.line}><td>{item.line}</td><td>{item.name} · {item.studentNumber}번</td><td>{item.schoolName} / {item.grade}학년 {item.classNumber}반</td><td>{item.loginId}</td></tr>)}</tbody></table>
              </div>
            )}
            <button type="button" className="button primary full" onClick={() => void submit("import")} disabled={busy !== null || preview.conflicts.length > 0}>{busy === "import" ? <><LoaderCircle size={15} className="spin" />계정을 만드는 중…</> : `${preview.studentCount}명 계정 발급`}</button>
          </section>
        ) : null}

        {credentials ? (
          <section className="student-roster-result" aria-live="polite">
            <header><span><CheckCircle2 size={19} /><b>{credentials.length}명 계정 발급 완료</b></span><button type="button" className="button soft" onClick={downloadCredentials}><Download size={14} />아이디·초기 비밀번호 CSV</button></header>
            <p>초기 비밀번호는 서버에 평문으로 보관되지 않습니다. 지금 내려받아 안전하게 전달해 주세요. 학생은 첫 로그인 직후 새 비밀번호를 설정해야 합니다.</p>
            <div><table><thead><tr><th>이름</th><th>소속</th><th>아이디</th><th>초기 비밀번호</th></tr></thead><tbody>{credentials.slice(0, 20).map((item) => <tr key={item.loginId}><td>{item.name}</td><td>{item.grade}학년 {item.classNumber}반 {item.studentNumber}번</td><td>{item.loginId}</td><td>{item.initialPassword}</td></tr>)}</tbody></table></div>
            {credentials.length > 20 ? <small>화면에는 20명만 표시합니다. 전체 목록은 CSV에서 확인해 주세요.</small> : null}
          </section>
        ) : null}
        {error ? <p className="form-error" role="alert">{error}</p> : null}
      </div>
    </section>
  );
}
