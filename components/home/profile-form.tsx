"use client";

import { useEffect, useRef, useState, type ChangeEvent, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { signOut } from "next-auth/react";
import { Check, ChevronRight, KeyRound, Mail, School, UserRound, Users } from "lucide-react";
import { Avatar } from "@/components/ui/avatar";
import { useConfirm } from "@/components/ui/app-dialog";
import { Modal } from "@/components/ui/modal";
import { LoginIdChangeForm } from "@/components/home/login-id-change-form";
import { PasswordChangeForm } from "@/components/home/password-change-form";
import styles from "@/components/home/pad-dashboard.module.css";

// 예전에는 이 폼이 모달 안에 있었지만("마이페이지가 왜 굳이 창을 띄우냐"는 피드백), 지금은
// /profile 라우트의 페이지 본문입니다. 폼 자체의 마크업·핸들러는 그대로 옮겨왔고, 탈퇴 후
// 로그아웃만 컨텍스트(HomeAuthActionsProvider.logout) 대신 signOut을 직접 호출합니다.
const roleLabel = { SUPER_ADMIN: "전체관리자", ADMIN: "보조관리자", TEACHER: "교사", STUDENT: "학생" } as const;

export function ProfileForm({ initialName, initialImage, loginIdentifier, loginType, role, school, schoolGroup, hasPasswordCredential, studentNumber }: {
  initialName: string | null;
  initialImage: string | null;
  loginIdentifier: string;
  loginType: "LOGIN_ID" | "KAKAO_EMAIL";
  role: keyof typeof roleLabel;
  school: { id: string; name: string } | null;
  schoolGroup: { id: string; name: string; type: "CLASS" | "DEPARTMENT" } | null;
  hasPasswordCredential: boolean;
  studentNumber: number | null;
}) {
  const router = useRouter();
  const confirm = useConfirm();
  const [name, setName] = useState(initialName ?? "");
  const [image, setImage] = useState(initialImage);
  // 한 번에 하나의 동작만 진행 중임을 구분해서, 어느 버튼이 "지금 처리 중"인지 문구로 보여줍니다
  // (이전에는 pending 하나만 있어서 사진을 올리는 동안에도 아무 안내 없이 버튼만 비활성화됐습니다).
  const [busy, setBusy] = useState<"name-check" | "name" | "photo" | "remove" | "delete" | null>(null);
  const [nicknameStatus, setNicknameStatus] = useState<"idle" | "available" | "taken">("idle");
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState("");
  const [deleteError, setDeleteError] = useState("");
  const [securityDialog, setSecurityDialog] = useState<"login-id" | "password" | null>(null);
  const savedTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pending = busy !== null;
  const usesEmailLogin = loginType === "KAKAO_EMAIL";

  useEffect(() => () => { if (savedTimer.current) clearTimeout(savedTimer.current); }, []);

  function flashSaved() {
    setSaved(true);
    if (savedTimer.current) clearTimeout(savedTimer.current);
    savedTimer.current = setTimeout(() => setSaved(false), 2200);
  }

  async function checkNickname() {
    setError("");
    if (!name.trim()) {
      setError("닉네임을 입력해 주세요.");
      return false;
    }
    setBusy("name-check");
    try {
      const response = await fetch("/api/me/nickname-availability", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name }),
      });
      const result = await response.json() as { available?: boolean; normalized?: string; error?: string };
      if (!response.ok || !result.available) {
        setNicknameStatus("taken");
        setError(result.error || "이미 사용 중인 닉네임입니다.");
        return false;
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

  async function saveName(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    if (nicknameStatus !== "available" && !await checkNickname()) return;
    setBusy("name");
    try {
      const response = await fetch("/api/me", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name }),
      });
      const result = await response.json();
      if (!response.ok) {
        setError(result.error);
        return;
      }
      setName(result.name);
      setNicknameStatus("available");
      flashSaved();
      router.refresh();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "프로필을 저장하지 못했습니다.");
    } finally {
      setBusy(null);
    }
  }

  async function uploadPhoto(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    setError("");
    setBusy("photo");
    try {
      const form = new FormData();
      form.append("file", file);
      const response = await fetch("/api/me/avatar", { method: "POST", body: form });
      const result = await response.json();
      if (!response.ok) {
        setError(result.error);
        return;
      }
      setImage(result.image);
      router.refresh();
    } finally {
      setBusy(null);
    }
  }

  async function removePhoto() {
    setError("");
    setBusy("remove");
    try {
      const response = await fetch("/api/me/avatar", { method: "DELETE" });
      if (!response.ok) {
        setError((await response.json()).error);
        return;
      }
      setImage(null);
      router.refresh();
    } finally {
      setBusy(null);
    }
  }

  async function deleteAccount() {
    if (!(await confirm({ description: "정말 탈퇴하시겠어요? 현재 계정은 탈퇴 처리되며 되돌릴 수 없습니다.", confirmLabel: "탈퇴", danger: true }))) return;
    setDeleteError("");
    setBusy("delete");
    try {
      const response = await fetch("/api/me", { method: "DELETE" });
      if (!response.ok) {
        setDeleteError((await response.json()).error);
        return;
      }
      await signOut({ callbackUrl: "/" });
    } finally {
      setBusy(null);
    }
  }

  return (
    <section className={styles.root}>
      <header className={styles.heading}>
        <div><span className={styles.eyebrow}>MY PAGE</span><h1>내 프로필</h1></div>
      </header>

      <div className="profile-page-grid">
        <aside className="profile-summary-card">
          <Avatar name={name} identifier={loginIdentifier} image={image} size="medium" />
          <div className="profile-summary-copy">
            <span className="profile-role">{roleLabel[role]}</span>
            <h2>{name || "이름 없음"}</h2>
            <p>{usesEmailLogin ? <Mail size={14} aria-hidden /> : <UserRound size={14} aria-hidden />}{loginIdentifier}</p>
            <dl>
              <div><dt><School size={14} aria-hidden />학교</dt><dd>{school?.name ?? "미지정"}</dd></div>
              <div><dt><Users size={14} aria-hidden />{schoolGroup?.type === "DEPARTMENT" ? "부서" : "반"}</dt><dd>{schoolGroup?.name ?? "미지정"}</dd></div>
              {role === "STUDENT" && studentNumber ? <div><dt>출석번호</dt><dd>{studentNumber}번</dd></div> : null}
            </dl>
          </div>
          <div className="profile-photo-actions">
            <label className="button soft small">
              {busy === "photo" ? "업로드 중..." : "사진 바꾸기"}
              <input type="file" accept="image/*" onChange={uploadPhoto} disabled={pending} hidden />
            </label>
            {image && <button type="button" className="button ghost small" onClick={removePhoto} disabled={pending}>{busy === "remove" ? "제거하는 중..." : "제거"}</button>}
          </div>
        </aside>

        <div className="stack-form profile-page-form">
          <section className="profile-form-section">
            <header><span>프로필 정보</span><small>패드와 댓글에 표시되는 이름입니다.</small></header>
            <form onSubmit={saveName}>
              <label>닉네임<div className="nickname-input-row"><input name="name" value={name} onChange={(event) => { setName(event.target.value); setNicknameStatus("idle"); setSaved(false); setError(""); }} required maxLength={60} disabled={pending} /><button type="button" className="button soft" disabled={pending || !name.trim()} onClick={() => void checkNickname()}>{busy === "name-check" ? "확인 중…" : "중복 확인"}</button></div><span className="nickname-status" data-status={nicknameStatus}>{nicknameStatus === "available" ? "사용할 수 있는 닉네임입니다." : nicknameStatus === "taken" ? "다른 닉네임을 입력해 주세요." : "저장 전에 중복 여부를 확인합니다."}</span></label>
              {error && <p className="form-error" role="alert">{error}</p>}
              <button className="button primary full" disabled={pending}>{busy === "name" ? "저장하는 중..." : saved ? <><Check size={15} />저장됨</> : "저장"}</button>
            </form>
          </section>
          {hasPasswordCredential ? (
            <section className="profile-form-section profile-password-section">
              <header><span>로그인 보안</span><small>변경할 항목을 선택해 안전하게 관리하세요.</small></header>
              <div className="profile-security-actions">
                <button type="button" onClick={() => setSecurityDialog("login-id")} aria-label={`로그인 아이디 ${loginIdentifier} 변경`}>
                  <span className="profile-security-icon"><UserRound size={18} aria-hidden /></span>
                  <span className="profile-security-copy"><b>로그인 아이디</b><small>{loginIdentifier}</small></span>
                  <span className="profile-security-action">변경<ChevronRight size={16} aria-hidden /></span>
                </button>
                <button type="button" onClick={() => setSecurityDialog("password")}>
                  <span className="profile-security-icon"><KeyRound size={18} aria-hidden /></span>
                  <span className="profile-security-copy"><b>비밀번호</b><small>비밀번호 로그인 사용 중</small></span>
                  <span className="profile-security-action">변경<ChevronRight size={16} aria-hidden /></span>
                </button>
              </div>
            </section>
          ) : null}
          <div className="settings-info-zone">
            <span><b>내 데이터 다운로드</b><small>내가 만든 패드 목록, 참여 중인 패드, 작성한 글·댓글을 JSON으로 받아요.</small></span>
            <a className="button soft" href="/api/me/export" download>다운로드</a>
          </div>
          <div className="settings-danger-zone">
            <span><b>계정 탈퇴</b><small>현재 계정은 탈퇴 처리되며 되돌릴 수 없어요. 소유한 패드는 다른 관리자에게 자동으로 이전돼요.</small></span>
            <button type="button" className="button danger" onClick={deleteAccount} disabled={pending}>{busy === "delete" ? "처리하는 중..." : "탈퇴"}</button>
          </div>
          {deleteError && <p className="form-error" role="alert">{deleteError}</p>}
        </div>
      </div>

      {securityDialog ? (
        <Modal
          open
          onClose={() => setSecurityDialog(null)}
          title={securityDialog === "login-id" ? "로그인 아이디 변경" : "비밀번호 변경"}
          description="변경이 완료되면 모든 기기에서 로그아웃됩니다."
          className="profile-security-modal"
        >
          {securityDialog === "login-id"
            ? <LoginIdChangeForm currentLoginId={loginIdentifier} showHeading={false} />
            : <PasswordChangeForm showHeading={false} />}
        </Modal>
      ) : null}
    </section>
  );
}
