"use client";

import { useState } from "react";
import { LoaderCircle, Settings2 } from "lucide-react";
import { UPLOAD_POLICY_BOUNDS, type UploadPolicy } from "@/lib/files/upload-policy-shape";
import {
  PLATFORM_SECURITY_POLICY_BOUNDS,
  type PlatformSecurityPolicy,
} from "@/lib/security/platform-policy-shape";
import type { AdminSettings } from "@/lib/settings/admin-settings";

async function responseJson(response: Response) {
  const result = await response.json().catch(() => ({ error: "서버 응답을 확인하지 못했습니다." }));
  if (!response.ok) throw new Error(result.error || "요청을 처리하지 못했습니다.");
  return result;
}

// 퀴즈 한도는 "비워 두면 무제한"이 의미 있는 값이라 빈 문자열을 null로 다룹니다(교사 기본값).
// 패드 한도에는 그런 개념이 없어 항상 숫자입니다.
function toLimit(value: string): number | null {
  return value.trim() === "" ? null : Number(value);
}
function fromLimit(value: number | null): string {
  return value === null ? "" : String(value);
}

// 업로드 상한은 관리자가 실제로 조정하는 순서대로 늘어놓습니다. 설명에 "무엇이 걸리는지"를
// 적어 두어야 숫자만 보고 잘못 줄이는 일이 줄어듭니다.
const UPLOAD_FIELDS: { key: keyof UploadPolicy; label: string; hint: string; slider?: boolean }[] = [
  { key: "maxUploadMb", label: "첨부 파일 최대 용량", hint: "패드 게시물·댓글에 올리는 모든 파일의 상한입니다. 최대 30MB이며 아래 값들은 이 값을 넘을 수 없습니다.", slider: true },
  { key: "maxImageUploadMb", label: "이미지 최대 용량", hint: "서버가 어차피 WebP로 다시 인코딩하므로 원본이 클 이유가 적습니다.", slider: true },
  { key: "guestMaxUploadMb", label: "손님 업로드 최대 용량", hint: "비로그인 참여자에게 적용합니다. 손님은 사진만 올릴 수 있어 사실상 사진 상한이며, 위 이미지 상한과 함께 작은 쪽이 걸립니다.", slider: true },
  { key: "maxBoardBackgroundMb", label: "패드 배경 이미지 최대 용량", hint: "패드 한 개당 배경 한 장입니다.", slider: true },
  { key: "maxQuizImageMb", label: "퀴즈 이미지 최대 용량", hint: "문항 이미지·퀴즈 썸네일 한 장의 상한입니다.", slider: true },
  { key: "maxQuizImageStorageMb", label: "퀴즈 1개당 이미지 총 용량", hint: "개당 상한만으로는 문항을 계속 늘려 디스크를 채우는 것을 막지 못합니다." },
];

const SECURITY_FIELDS: { key: keyof PlatformSecurityPolicy; label: string; hint: string }[] = [
  { key: "adminReauthWindowMinutes", label: "민감 작업 재인증 유효 시간 (분)", hint: "비밀번호 초기화·회원 삭제·권한 변경 같은 작업 전에 마지막 실제 로그인을 확인합니다." },
  { key: "publicQuizJoinPerMinute", label: "공개 퀴즈 참여 요청 / 분", hint: "학교 공용 IP에서 한 반이 동시에 입장할 수 있는 상한입니다. 잘못된 PIN은 별도 20회/분으로 제한합니다." },
  { key: "publicQuizApiRequestsPerMinute", label: "공개 퀴즈 API 요청 / 분", hint: "참여자 한 명의 시작·문항 조회·답안·결과 요청을 합산합니다." },
  { key: "publicQuizSocketEventsPerMinute", label: "공개 퀴즈 소켓 이벤트 / 분", hint: "참여자 또는 접속 IP가 보낼 수 있는 실시간 이벤트 상한입니다." },
  { key: "publicQuizSocketMaxConnections", label: "공개 퀴즈 전체 소켓 연결", hint: "이 서버 프로세스가 동시에 유지할 공개 퀴즈 연결의 최대 개수입니다." },
  { key: "publicQuizSocketConnectionsPerIp", label: "IP별 공개 소켓 연결", hint: "학교 NAT 환경을 고려한 상한입니다. 한 네트워크의 예상 동시 참여자보다 충분히 크게 두세요(기본 200)." },
  { key: "publicQuizSocketConnectionsPerParticipant", label: "참여자별 소켓 연결", hint: "한 참여자가 여러 탭으로 동시에 연결할 수 있는 최대 개수입니다." },
];

export function SystemSettingsPanel({
  initialSettings,
  onAuditChanged,
}: {
  initialSettings: AdminSettings;
  onAuditChanged?: () => void;
}) {
  const [studentBoardLimit, setStudentBoardLimit] = useState(initialSettings.studentBoardLimit);
  const [teacherBoardLimit, setTeacherBoardLimit] = useState(initialSettings.teacherBoardLimit);
  const [studentQuizLimit, setStudentQuizLimit] = useState(fromLimit(initialSettings.studentQuizLimit));
  const [teacherQuizLimit, setTeacherQuizLimit] = useState(fromLimit(initialSettings.teacherQuizLimit));
  const [savedStudentBoardLimit, setSavedStudentBoardLimit] = useState(initialSettings.studentBoardLimit);
  const [savedTeacherBoardLimit, setSavedTeacherBoardLimit] = useState(initialSettings.teacherBoardLimit);
  const [savedStudentQuizLimit, setSavedStudentQuizLimit] = useState(fromLimit(initialSettings.studentQuizLimit));
  const [savedTeacherQuizLimit, setSavedTeacherQuizLimit] = useState(fromLimit(initialSettings.teacherQuizLimit));

  // 서버 페이지가 소유 한도·업로드·보안 정책을 한 번에 내려줍니다. 탭 마운트 뒤 같은 설정을
  // 다시 GET하지 않으며, 저장 응답으로 편집값과 기준값을 함께 갱신합니다.
  const [uploads, setUploads] = useState<UploadPolicy>(() => Object.fromEntries(UPLOAD_FIELDS.map(({ key }) => [key, initialSettings[key]])) as UploadPolicy);
  const [savedUploads, setSavedUploads] = useState<UploadPolicy>(() => Object.fromEntries(UPLOAD_FIELDS.map(({ key }) => [key, initialSettings[key]])) as UploadPolicy);
  const [security, setSecurity] = useState<PlatformSecurityPolicy>(() => Object.fromEntries(SECURITY_FIELDS.map(({ key }) => [key, initialSettings[key]])) as PlatformSecurityPolicy);
  const [savedSecurity, setSavedSecurity] = useState<PlatformSecurityPolicy>(() => Object.fromEntries(SECURITY_FIELDS.map(({ key }) => [key, initialSettings[key]])) as PlatformSecurityPolicy);

  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState("");

  const uploadsDirty = UPLOAD_FIELDS.some(({ key }) => uploads[key] !== savedUploads[key]);
  const securityDirty = SECURITY_FIELDS.some(({ key }) => security[key] !== savedSecurity[key]);
  const dirty = studentBoardLimit !== savedStudentBoardLimit
    || teacherBoardLimit !== savedTeacherBoardLimit
    || studentQuizLimit !== savedStudentQuizLimit
    || teacherQuizLimit !== savedTeacherQuizLimit
    || uploadsDirty
    || securityDirty;

  // 저장하기 전에 같은 규칙을 화면에서도 알려 줍니다(서버도 같은 조건으로 거절합니다).
  const ceilingBroken = UPLOAD_FIELDS
    .filter(({ key }) => key !== "maxUploadMb" && key !== "maxQuizImageStorageMb")
    .filter(({ key }) => uploads[key] > uploads.maxUploadMb);
  const socketCeilingBroken = security.publicQuizSocketConnectionsPerParticipant > security.publicQuizSocketConnectionsPerIp
    || security.publicQuizSocketConnectionsPerIp > security.publicQuizSocketMaxConnections;

  async function save() {
    if (!dirty || pending || ceilingBroken.length || socketCeilingBroken) return;
    setPending(true);
    setMessage("");
    try {
      const result = await responseJson(await fetch("/api/admin/settings", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          studentBoardLimit,
          teacherBoardLimit,
          studentQuizLimit: toLimit(studentQuizLimit),
          teacherQuizLimit: toLimit(teacherQuizLimit),
          ...uploads,
          ...security,
        }),
      }));
      setSavedStudentBoardLimit(result.studentBoardLimit);
      setSavedTeacherBoardLimit(result.teacherBoardLimit);
      setStudentBoardLimit(result.studentBoardLimit);
      setTeacherBoardLimit(result.teacherBoardLimit);
      setSavedStudentQuizLimit(fromLimit(result.studentQuizLimit));
      setSavedTeacherQuizLimit(fromLimit(result.teacherQuizLimit));
      setStudentQuizLimit(fromLimit(result.studentQuizLimit));
      setTeacherQuizLimit(fromLimit(result.teacherQuizLimit));
      const nextUploads = { ...uploads };
      for (const { key } of UPLOAD_FIELDS) {
        if (typeof result[key] === "number") nextUploads[key] = result[key];
      }
      setUploads(nextUploads);
      setSavedUploads(nextUploads);
      const nextSecurity = { ...security };
      for (const { key } of SECURITY_FIELDS) {
        if (typeof result[key] === "number") nextSecurity[key] = result[key];
      }
      setSecurity(nextSecurity);
      setSavedSecurity(nextSecurity);
      setMessage("정책을 저장했습니다.");
      onAuditChanged?.();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "저장하지 못했습니다.");
    } finally {
      setPending(false);
    }
  }

  return (
    <section className="admin-panel system-settings-panel" role="tabpanel">
      <header className="admin-panel-header">
        <div><span className="admin-kicker">POLICY</span><h2>정책</h2><p>학생·교사 계정이 소유할 수 있는 최대 패드·퀴즈 개수와 업로드 용량 상한을 정합니다. 퀴즈 한도는 비워 두면 무제한입니다.</p></div>
      </header>
      <div className="system-settings-body">
        <section className="system-settings-group">
          <header><h3 className="system-settings-group-title">소유 한도</h3><p>계정 유형별로 만들 수 있는 패드와 퀴즈 수를 제한합니다.</p></header>
          <div className="system-settings-fields">
            <label><span>학생 최대 소유 패드 수</span><input type="number" min={1} max={1000} value={studentBoardLimit} onChange={(event) => setStudentBoardLimit(Number(event.target.value))} disabled={pending} /></label>
            <label><span>교사 최대 소유 패드 수</span><input type="number" min={1} max={1000} value={teacherBoardLimit} onChange={(event) => setTeacherBoardLimit(Number(event.target.value))} disabled={pending} /></label>
            <label><span>학생 최대 소유 퀴즈 수</span><input type="number" min={0} max={1000} placeholder="무제한" value={studentQuizLimit} onChange={(event) => setStudentQuizLimit(event.target.value)} disabled={pending} /></label>
            <label><span>교사 최대 소유 퀴즈 수</span><input type="number" min={0} max={1000} placeholder="무제한" value={teacherQuizLimit} onChange={(event) => setTeacherQuizLimit(event.target.value)} disabled={pending} /></label>
          </div>
        </section>

        <section className="system-settings-group">
          <header><h3 className="system-settings-group-title">업로드 용량</h3><p>파일 유형별 1회 업로드 상한을 1~30MB 범위에서 조정합니다. 퀴즈 누적 용량은 숫자로 직접 입력합니다.</p></header>
          <div className="system-settings-fields">
            {UPLOAD_FIELDS.map(({ key, label, hint, slider }) => (
              <label key={key}>
                <span>{label}</span>
                {slider ? (
                  <div className="system-settings-range-control">
                    <input type="range" min={UPLOAD_POLICY_BOUNDS[key].min} max={UPLOAD_POLICY_BOUNDS[key].max} step={1} value={uploads[key]} aria-label={`${label}: ${uploads[key]}MB`} onChange={(event) => setUploads((current) => ({ ...current, [key]: Number(event.target.value) }))} disabled={pending || savedUploads === null} />
                    <output>{uploads[key]}MB</output>
                  </div>
                ) : (
                  <input type="number" min={UPLOAD_POLICY_BOUNDS[key].min} max={UPLOAD_POLICY_BOUNDS[key].max} value={uploads[key]} onChange={(event) => setUploads((current) => ({ ...current, [key]: Number(event.target.value) }))} disabled={pending || savedUploads === null} />
                )}
                <small className="system-settings-hint">{hint}</small>
              </label>
            ))}
          </div>
          {ceilingBroken.length ? <p className="school-dashboard-message" role="alert">{ceilingBroken.map(({ label }) => label).join(", ")} 값이 첨부 파일 최대 용량({uploads.maxUploadMb}MB)보다 큽니다.</p> : null}
        </section>

        <section className="system-settings-group">
          <header><h3 className="system-settings-group-title">보안·공개 퀴즈</h3><p>인증 요청과 실시간 퀴즈 연결이 몰릴 때 적용할 제한입니다.</p></header>
          <div className="system-settings-fields">
            {SECURITY_FIELDS.map(({ key, label, hint }) => (
              <label key={key}>
                <span>{label}</span>
                <input type="number" min={PLATFORM_SECURITY_POLICY_BOUNDS[key].min} max={PLATFORM_SECURITY_POLICY_BOUNDS[key].max} value={security[key]} onChange={(event) => setSecurity((current) => ({ ...current, [key]: Number(event.target.value) }))} disabled={pending || savedSecurity === null} />
                <small className="system-settings-hint">{hint}</small>
              </label>
            ))}
          </div>
          {socketCeilingBroken ? <p className="school-dashboard-message" role="alert">소켓 연결 상한은 참여자별 ≤ IP별 ≤ 전체 순서로 입력해 주세요.</p> : null}
        </section>

        <div className="system-settings-savebar">
          <span>{message || (dirty ? "저장하지 않은 변경사항이 있습니다." : "모든 설정이 저장되었습니다.")}</span>
          <button type="button" className="button primary" onClick={() => void save()} disabled={!dirty || pending || savedUploads === null || savedSecurity === null || ceilingBroken.length > 0 || socketCeilingBroken}>
            {pending ? <LoaderCircle size={14} className="spin" /> : <Settings2 size={14} />}설정 저장
          </button>
        </div>
      </div>
    </section>
  );
}
