"use client";

import { useRef, useState, type ChangeEvent, type FormEvent } from "react";
import Link from "next/link";
import { SessionProvider, signOut, useSession } from "next-auth/react";
import {
  ArrowLeft,
  ArrowRight,
  Building2,
  Check,
  CheckCircle2,
  GraduationCap,
  LoaderCircle,
  Mail,
  School,
  ShieldCheck,
  Sparkles,
  Upload,
  UserRound,
  Users,
} from "lucide-react";
import { Avatar } from "@/components/ui/avatar";
import { Logo } from "@/components/ui/logo";
import { ThemeToggle } from "@/components/ui/theme-toggle";
import { APP_NAME } from "@/lib/brand";
import styles from "@/components/onboarding/onboarding.module.css";

type UserRole = "SUPER_ADMIN" | "ADMIN" | "TEACHER" | "STUDENT";
type SchoolOption = {
  id: string;
  name: string;
  groups: Array<{
    id: string;
    name: string;
    type: "CLASS" | "DEPARTMENT";
    grade: number | null;
    classNumber: number | null;
  }>;
};

type OnboardingProps = {
  initialName: string | null;
  initialImage: string | null;
  loginIdentifier: string;
  loginType: "LOGIN_ID" | "KAKAO_EMAIL";
  role: UserRole;
  initialAccountType: "STUDENT" | "TEACHER";
  initialSchoolId: string | null;
  initialSchoolGroupId: string | null;
  initialStudentNumber: number | null;
  rejectionReason: string | null;
  schools: SchoolOption[];
  nextPath: string;
};

const STEPS = [
  { label: "프로필", description: "닉네임과 사진" },
  { label: "소속", description: "학교와 반·부서" },
  { label: "확인", description: "가입 정보 마무리" },
] as const;

export function OnboardingExperience(props: OnboardingProps) {
  return (
    <SessionProvider refetchOnWindowFocus={false}>
      <OnboardingForm {...props} />
    </SessionProvider>
  );
}

function OnboardingForm({
  initialName,
  initialImage,
  loginIdentifier,
  loginType,
  role,
  initialAccountType,
  initialSchoolId,
  initialSchoolGroupId,
  initialStudentNumber,
  rejectionReason,
  schools,
  nextPath,
}: OnboardingProps) {
  const usesEmailLogin = loginType === "KAKAO_EMAIL";
  const { update: updateSession } = useSession();
  const photoInputRef = useRef<HTMLInputElement>(null);
  const [step, setStep] = useState(0);
  const [name, setName] = useState(initialName ?? "");
  const [image, setImage] = useState(initialImage);
  const [accountType, setAccountType] = useState(initialAccountType);
  const [schoolId, setSchoolId] = useState(initialSchoolId ?? "");
  const [schoolGroupId, setSchoolGroupId] = useState(initialSchoolGroupId ?? "");
  const initialGroup = schools.flatMap((school) => school.groups).find((group) => group.id === initialSchoolGroupId);
  const [grade, setGrade] = useState(initialGroup?.grade?.toString() ?? "");
  const [studentNumber, setStudentNumber] = useState(initialStudentNumber?.toString() ?? "");
  const [busy, setBusy] = useState<"nickname" | "photo" | "remove-photo" | "complete" | "logout" | null>(null);
  const [error, setError] = useState("");
  const [nicknameStatus, setNicknameStatus] = useState<"idle" | "available" | "taken">("idle");

  const roleLocked = role !== "STUDENT";
  const expectedGroupType = accountType === "STUDENT" ? "CLASS" : "DEPARTMENT";
  const selectedSchool = schools.find((school) => school.id === schoolId) ?? null;
  const gradeOptions = [...new Set(
    selectedSchool?.groups
      .filter((group) => group.type === "CLASS" && group.grade !== null && group.classNumber !== null)
      .map((group) => group.grade as number) ?? [],
  )].sort((a, b) => a - b);
  const availableGroups = selectedSchool?.groups.filter((group) => (
    group.type === expectedGroupType
    && (accountType !== "STUDENT" || (group.grade?.toString() === grade && group.classNumber !== null))
  )) ?? [];
  const selectedGroup = availableGroups.find((group) => group.id === schoolGroupId) ?? null;
  const groupLabel = expectedGroupType === "CLASS" ? "소속 반" : "소속 부서";
  const pending = busy !== null;

  async function checkNickname() {
    setError("");
    if (!name.trim()) {
      setError("패드와 댓글에 표시할 닉네임을 입력해 주세요.");
      return false;
    }
    setBusy("nickname");
    try {
      const response = await fetch("/api/me/nickname-availability", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name }),
      });
      const result = await response.json() as { available?: boolean; normalized?: string; error?: string };
      if (!response.ok || !result.available) {
        setNicknameStatus("taken");
        throw new Error(result.error || "이미 사용 중인 닉네임입니다.");
      }
      if (result.normalized) setName(result.normalized);
      setNicknameStatus("available");
      return true;
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "닉네임 사용 여부를 확인하지 못했습니다.");
      return false;
    } finally {
      setBusy(null);
    }
  }

  async function moveNext() {
    setError("");
    if (step === 0 && !name.trim()) {
      setError("패드와 댓글에 표시할 닉네임을 입력해 주세요.");
      return;
    }
    if (step === 0 && nicknameStatus !== "available" && !await checkNickname()) return;
    const parsedStudentNumber = Number(studentNumber);
    if (step === 1 && (!selectedSchool || !selectedGroup || (accountType === "STUDENT" && (!Number.isInteger(parsedStudentNumber) || parsedStudentNumber < 1 || parsedStudentNumber > 99)))) {
      setError(accountType === "STUDENT" ? "학교, 학년, 반과 1~99 사이의 번호를 모두 입력해 주세요." : `학교와 ${groupLabel}를 모두 선택해 주세요.`);
      return;
    }
    setStep((current) => Math.min(2, current + 1));
  }

  function moveBack() {
    setError("");
    setStep((current) => Math.max(0, current - 1));
  }

  function changeSchool(nextSchoolId: string) {
    setSchoolId(nextSchoolId);
    setGrade("");
    setSchoolGroupId("");
    setError("");
  }

  function changeAccountType(nextAccountType: "STUDENT" | "TEACHER") {
    if (roleLocked || nextAccountType === accountType) return;
    setAccountType(nextAccountType);
    setGrade("");
    setSchoolGroupId("");
    if (nextAccountType === "TEACHER") setStudentNumber("");
    setError("");
  }

  async function uploadPhoto(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.currentTarget.value = "";
    if (!file) return;
    setError("");
    if (file.size > 10 * 1024 * 1024) {
      setError("프로필 이미지는 10MB 이하만 올릴 수 있어요.");
      return;
    }
    setBusy("photo");
    try {
      const body = new FormData();
      body.set("file", file);
      const response = await fetch("/api/me/avatar", { method: "POST", body });
      const result = await response.json() as { image?: string; error?: string };
      if (!response.ok || !result.image) throw new Error(result.error || "프로필 이미지를 올리지 못했습니다.");
      setImage(result.image);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "프로필 이미지를 올리지 못했습니다.");
    } finally {
      setBusy(null);
    }
  }

  async function removePhoto() {
    setError("");
    setBusy("remove-photo");
    try {
      const response = await fetch("/api/me/avatar", { method: "DELETE" });
      const result = await response.json() as { error?: string };
      if (!response.ok) throw new Error(result.error || "프로필 이미지를 지우지 못했습니다.");
      setImage(null);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "프로필 이미지를 지우지 못했습니다.");
    } finally {
      setBusy(null);
    }
  }

  async function completeOnboarding(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (step < 2) {
      await moveNext();
      return;
    }
    const parsedStudentNumber = Number(studentNumber);
    if (!selectedSchool || !selectedGroup || !name.trim() || (accountType === "STUDENT" && (!Number.isInteger(parsedStudentNumber) || parsedStudentNumber < 1 || parsedStudentNumber > 99))) {
      setError("가입 정보를 다시 확인해 주세요.");
      return;
    }
    setError("");
    setBusy("complete");
    try {
      const response = await fetch("/api/onboarding", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name,
          accountType,
          schoolId: selectedSchool.id,
          schoolGroupId: selectedGroup.id,
          studentNumber: accountType === "STUDENT" ? parsedStudentNumber : null,
        }),
      });
      const result = await response.json() as { error?: string; approvalPending?: boolean };
      // 이미 생성된 교사 승인 요청은 대기 화면으로 복구할 수 있지만, 같은 409라도 닉네임
      // 동시 선점이나 완료된 온보딩은 성공으로 취급하면 안 됩니다.
      if (!response.ok && !(response.status === 409 && result.approvalPending)) {
        if (response.status === 409 && result.error?.includes("닉네임")) setNicknameStatus("taken");
        throw new Error(result.error || "가입 정보를 저장하지 못했습니다.");
      }
      const session = await updateSession({
        onboardingCompleted: !result.approvalPending,
        onboardingState: result.approvalPending ? "TEACHER_PENDING" : "COMPLETE",
      });
      const expectedState = result.approvalPending ? "TEACHER_PENDING" : "COMPLETE";
      if (session?.user?.onboardingState !== expectedState) {
        throw new Error("가입 정보는 저장됐지만 세션을 갱신하지 못했습니다. 잠시 후 다시 시도해 주세요.");
      }
      window.location.replace(result.approvalPending
        ? `/approval-pending?next=${encodeURIComponent(nextPath)}`
        : nextPath);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "가입 정보를 저장하지 못했습니다.");
      setBusy(null);
    }
  }

  async function logout() {
    setBusy("logout");
    await signOut({ callbackUrl: "/" });
  }

  return (
    <main className={styles.page}>
      <nav className={styles.nav}>
        <Link href="/onboarding" className={styles.brand} aria-label={`${APP_NAME} 가입 정보 설정`}>
          <Logo size={27} /><b>{APP_NAME}</b>
        </Link>
        <div className={styles.navActions}>
          <ThemeToggle />
          <button type="button" className={styles.accountSwitch} disabled={pending} onClick={() => void logout()}>
            {busy === "logout" ? "로그아웃 중…" : "다른 계정으로 로그인"}
          </button>
        </div>
      </nav>

      <div className={styles.shell}>
        <aside className={styles.rail}>
          <div className={styles.railIntro}>
            <span className={styles.eyebrow}><Sparkles size={14} aria-hidden />처음 한 번만 설정해요</span>
            <h1>{APP_NAME}에서 사용할<br />나를 알려주세요.</h1>
            <p>선택한 정보는 학교 안에서 패드 멤버를 찾고 수업 그룹을 관리할 때 사용됩니다.</p>
          </div>
          <ol className={styles.steps}>
            {STEPS.map((item, index) => (
              <li key={item.label} data-active={step === index} data-done={step > index}>
                <span>{step > index ? <Check size={14} aria-hidden /> : index + 1}</span>
                <div><b>{item.label}</b><small>{item.description}</small></div>
              </li>
            ))}
          </ol>
          <div className={styles.privacyNote}>
            <ShieldCheck size={18} aria-hidden />
            <span><b>필요한 정보만 저장해요</b><small>로그인 정보와 프로필은 암호화해 보관합니다.</small></span>
          </div>
        </aside>

        <form className={styles.card} onSubmit={completeOnboarding}>
          <header className={styles.cardHeader}>
            <span>{String(step + 1).padStart(2, "0")} / 03</span>
            <h2>{step === 0 ? "프로필을 다듬어 주세요" : step === 1 ? "학교 소속을 선택해 주세요" : "이 정보로 시작할까요?"}</h2>
            <p>{step === 0 ? "카카오 프로필을 그대로 쓰거나 원하는 사진과 닉네임으로 바꿀 수 있어요." : step === 1 ? accountType === "STUDENT" ? "학생은 학교와 반을 선택하면 바로 시작할 수 있어요." : "교사는 학교 관리자의 승인 후 이용할 수 있어요." : "잘못 선택한 항목이 있다면 이전 단계로 돌아가 수정할 수 있어요."}</p>
          </header>

          <div className={styles.panel} hidden={step !== 0}>
            <div className={styles.photoEditor}>
              <div className={styles.avatarWrap}><Avatar name={name} identifier={loginIdentifier} image={image} size="medium" /></div>
              <div className={styles.photoCopy}>
                <b>프로필 사진</b>
                <small>정사각형 이미지가 가장 자연스럽게 보여요.</small>
                <div>
                  <input ref={photoInputRef} className={styles.hiddenInput} type="file" accept="image/jpeg,image/png,image/webp,.jpg,.jpeg,.png,.webp" onChange={uploadPhoto} />
                  <button type="button" className="button soft" disabled={pending} onClick={() => photoInputRef.current?.click()}>
                    {busy === "photo" ? <LoaderCircle size={15} className="spin" aria-hidden /> : <Upload size={15} aria-hidden />}
                    {busy === "photo" ? "올리는 중…" : image ? "사진 바꾸기" : "사진 선택"}
                  </button>
                  {image && <button type="button" className="button ghost" disabled={pending} onClick={() => void removePhoto()}>{busy === "remove-photo" ? "지우는 중…" : "사진 지우기"}</button>}
                </div>
              </div>
            </div>
            <label className={styles.field}>
              <span><UserRound size={16} aria-hidden />닉네임</span>
              <div className={styles.nicknameRow}>
                <input value={name} onChange={(event) => { setName(event.target.value); setNicknameStatus("idle"); setError(""); }} maxLength={60} placeholder="패드에 표시할 이름" autoFocus disabled={pending} />
                <button type="button" className="button soft" disabled={pending || !name.trim()} onClick={() => void checkNickname()}>{busy === "nickname" ? "확인 중…" : "중복 확인"}</button>
              </div>
              <small><span data-status={nicknameStatus}>{nicknameStatus === "available" ? "사용할 수 있는 닉네임입니다." : nicknameStatus === "taken" ? "다른 닉네임을 입력해 주세요." : "패드·게시물·댓글에 표시됩니다."}</span><b>{name.length}/60</b></small>
            </label>
            <div className={styles.readonlyField}>
              <span>{usesEmailLogin ? <Mail size={16} aria-hidden /> : <UserRound size={16} aria-hidden />}{usesEmailLogin ? "로그인 이메일" : "로그인 아이디"}</span>
              <b>{loginIdentifier}</b>
              <small>로그인 확인에만 사용되며 다른 사용자에게 공개하지 않습니다.</small>
            </div>
          </div>

          <div className={styles.panel} hidden={step !== 1}>
            {rejectionReason && accountType === "TEACHER" && (
              <p className={styles.rejection} role="status">
                <b>이전 교사 신청이 반려되었습니다.</b>
                <span>{rejectionReason}</span>
              </p>
            )}
            <fieldset className={styles.accountTypes}>
              <legend>가입 유형</legend>
              <button type="button" data-selected={accountType === "STUDENT"} disabled={pending || roleLocked} onClick={() => changeAccountType("STUDENT")}>
                <GraduationCap size={21} aria-hidden />
                <span><b>학생으로 가입</b><small>학교와 반을 선택하고 바로 시작해요.</small></span>
                {accountType === "STUDENT" && <Check size={15} aria-hidden />}
              </button>
              <button type="button" data-selected={accountType === "TEACHER"} disabled={pending || roleLocked} onClick={() => changeAccountType("TEACHER")}>
                <Building2 size={21} aria-hidden />
                <span><b>교사로 신청</b><small>학교·부서 확인 후 승인을 기다려요.</small></span>
                {accountType === "TEACHER" && <Check size={15} aria-hidden />}
              </button>
            </fieldset>
            <div className={styles.roleBanner}>
              {accountType === "STUDENT" ? <GraduationCap size={20} aria-hidden /> : <Building2 size={20} aria-hidden />}
              <span><small>{accountType === "STUDENT" ? "즉시 가입" : "승인 필요"}</small><b>{accountType === "STUDENT" ? "학생" : "교사 신청"}</b></span>
              <em>{expectedGroupType === "CLASS" ? "학생 반 선택" : "교사 부서 선택"}</em>
            </div>
            <label className={styles.field}>
              <span><School size={16} aria-hidden />소속 학교</span>
              <select value={schoolId} onChange={(event) => changeSchool(event.target.value)}>
                <option value="">학교를 선택해 주세요</option>
                {schools.map((school) => <option key={school.id} value={school.id}>{school.name}</option>)}
              </select>
              <small><span>관리자가 등록한 학교만 선택할 수 있어요.</span></small>
            </label>
            {accountType === "STUDENT" ? (
              <div className={styles.studentOrganization}>
                <label className={styles.field}>
                  <span><GraduationCap size={16} aria-hidden />학년</span>
                  <select value={grade} onChange={(event) => { setGrade(event.target.value); setSchoolGroupId(""); setError(""); }} disabled={!selectedSchool}>
                    <option value="">{selectedSchool ? "학년 선택" : "학교 먼저 선택"}</option>
                    {gradeOptions.map((item) => <option key={item} value={item}>{item}학년</option>)}
                  </select>
                </label>
                <label className={styles.field}>
                  <span><Users size={16} aria-hidden />반</span>
                  <select value={schoolGroupId} onChange={(event) => { setSchoolGroupId(event.target.value); setError(""); }} disabled={!selectedSchool || !grade}>
                    <option value="">{grade ? "반 선택" : "학년 먼저 선택"}</option>
                    {availableGroups.map((group) => <option key={group.id} value={group.id}>{group.classNumber}반</option>)}
                  </select>
                </label>
                <label className={styles.field}>
                  <span><UserRound size={16} aria-hidden />번호</span>
                  <input type="number" min={1} max={99} step={1} inputMode="numeric" value={studentNumber} onChange={(event) => { setStudentNumber(event.target.value); setError(""); }} placeholder="예: 6" />
                </label>
                {selectedSchool && gradeOptions.length === 0
                  ? <small className={styles.organizationHint} data-warning>이 학교에 학년·반이 없습니다. 학교 관리자에게 문의해 주세요.</small>
                  : <small className={styles.organizationHint}>학년·반·번호는 같은 학교 구성원을 찾고 명단을 관리할 때 사용됩니다.</small>}
              </div>
            ) : (
              <label className={styles.field}>
                <span><Users size={16} aria-hidden />{groupLabel}</span>
                <select value={schoolGroupId} onChange={(event) => { setSchoolGroupId(event.target.value); setError(""); }} disabled={!selectedSchool}>
                  <option value="">{selectedSchool ? `${groupLabel}를 선택해 주세요` : "학교를 먼저 선택해 주세요"}</option>
                  {availableGroups.map((group) => <option key={group.id} value={group.id}>{group.name}</option>)}
                </select>
                {selectedSchool && availableGroups.length === 0
                  ? <small className={styles.warning}><span>이 학교에 선택 가능한 {groupLabel}가 없습니다. 학교 관리자에게 문의해 주세요.</span></small>
                  : <small><span>같은 학교 구성원을 찾고 관리할 때 사용됩니다.</span></small>}
              </label>
            )}
          </div>

          <div className={styles.panel} hidden={step !== 2}>
            <div className={styles.completeIcon}><CheckCircle2 size={34} aria-hidden /></div>
            <dl className={styles.summary}>
              <div><dt>프로필</dt><dd><Avatar name={name} identifier={loginIdentifier} image={image} size="small" /><span><b>{name.trim()}</b><small>{loginIdentifier}</small></span></dd></div>
              <div><dt>가입 유형</dt><dd>{accountType === "STUDENT" ? <GraduationCap size={18} aria-hidden /> : <Building2 size={18} aria-hidden />}<span><b>{accountType === "STUDENT" ? "학생" : "교사 승인 요청"}</b><small>{accountType === "STUDENT" ? "가입 후 바로 이용할 수 있어요." : "승인 후 교사 권한이 부여돼요."}</small></span></dd></div>
              <div><dt>학교</dt><dd><School size={18} aria-hidden /><span><b>{selectedSchool?.name}</b><small>{selectedGroup?.name}{accountType === "STUDENT" ? ` · ${studentNumber}번` : ""}</small></span></dd></div>
            </dl>
            <p className={styles.completeNote}>{accountType === "STUDENT" ? "가입을 완료하면 내 패드 화면으로 이동합니다." : "신청 후 승인 대기 화면으로 이동합니다. 승인 결과는 다시 로그인해도 유지됩니다."} 학교 소속 변경이 필요하면 관리자에게 요청해 주세요.</p>
          </div>

          {error && <p className={styles.error} role="alert">{error}</p>}

          <footer className={styles.actions}>
            {step > 0 && <button type="button" className="button ghost" disabled={pending} onClick={moveBack}><ArrowLeft size={16} aria-hidden />이전</button>}
            <span />
            {step < 2
              ? <button type="button" className="button primary" disabled={pending} onClick={() => void moveNext()}>다음<ArrowRight size={16} aria-hidden /></button>
              : <button type="submit" className="button primary" disabled={pending}>{busy === "complete" ? <><LoaderCircle size={16} className="spin" aria-hidden />처리 중…</> : <>{accountType === "STUDENT" ? `${APP_NAME} 시작하기` : "교사 승인 요청"}<ArrowRight size={16} aria-hidden /></>}</button>}
          </footer>
        </form>
      </div>
    </main>
  );
}
