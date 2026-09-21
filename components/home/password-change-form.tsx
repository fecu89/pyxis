"use client";

import { useState, type FormEvent } from "react";
import { signOut } from "next-auth/react";
import { Check, KeyRound, LoaderCircle } from "lucide-react";

export function PasswordChangeForm({ forced = false, showHeading = true }: { forced?: boolean; showHeading?: boolean }) {
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [newPasswordConfirm, setNewPasswordConfirm] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const rules = {
    length: newPassword.length >= 10,
    letter: /[A-Za-z]/u.test(newPassword),
    number: /[0-9]/u.test(newPassword),
    symbol: /[^A-Za-z0-9\s]/u.test(newPassword),
    confirm: Boolean(newPasswordConfirm) && newPassword === newPasswordConfirm,
  };

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPending(true);
    setError("");
    try {
      const response = await fetch("/api/me/password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ currentPassword, newPassword, newPasswordConfirm }),
      });
      const result = await response.json().catch(() => ({ error: "서버 응답을 확인하지 못했습니다." }));
      if (!response.ok) {
        setError(result.error || "비밀번호를 변경하지 못했습니다.");
        return;
      }
      await signOut({ callbackUrl: "/login?passwordChanged=1" });
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "비밀번호를 변경하지 못했습니다.");
    } finally {
      setPending(false);
    }
  }

  return (
    <form className={`password-change-form${forced ? " forced" : ""}`} onSubmit={submit}>
      {showHeading ? <div className="password-change-heading">
        <span><KeyRound size={18} /></span>
        <div><b>{forced ? "새 비밀번호를 먼저 설정해 주세요" : "비밀번호 변경"}</b><small>{forced ? "관리자가 발급한 초기 비밀번호는 이번 로그인까지만 사용합니다." : "변경하면 모든 기기에서 로그아웃됩니다."}</small></div>
      </div> : null}
      <label>현재 비밀번호<input type="password" value={currentPassword} onChange={(event) => setCurrentPassword(event.target.value)} autoComplete="current-password" maxLength={128} required disabled={pending} autoFocus /></label>
      <label>새 비밀번호<input type="password" value={newPassword} onChange={(event) => setNewPassword(event.target.value)} autoComplete="new-password" minLength={10} maxLength={128} required disabled={pending} /></label>
      <ul className="auth-password-rules" aria-label="새 비밀번호 조건">
        <li data-met={rules.length}><Check size={12} />10자 이상</li>
        <li data-met={rules.letter}><Check size={12} />영문자</li>
        <li data-met={rules.number}><Check size={12} />숫자</li>
        <li data-met={rules.symbol}><Check size={12} />특수문자</li>
      </ul>
      <label>새 비밀번호 확인<input type="password" value={newPasswordConfirm} onChange={(event) => setNewPasswordConfirm(event.target.value)} autoComplete="new-password" minLength={10} maxLength={128} required disabled={pending} /></label>
      {newPasswordConfirm ? <span className="password-confirm-state" data-valid={rules.confirm}>{rules.confirm ? "새 비밀번호가 일치합니다." : "새 비밀번호가 일치하지 않습니다."}</span> : null}
      {error ? <p className="form-error" role="alert">{error}</p> : null}
      <button className="button primary full" disabled={pending || !Object.values(rules).every(Boolean)}>{pending ? <><LoaderCircle size={15} className="spin" />변경하는 중…</> : forced ? "새 비밀번호 설정" : "비밀번호 변경"}</button>
    </form>
  );
}
