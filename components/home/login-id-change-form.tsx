"use client";

import { useState, type FormEvent } from "react";
import { signOut } from "next-auth/react";
import { Check, LoaderCircle, UserRound } from "lucide-react";

export function LoginIdChangeForm({ currentLoginId, showHeading = true }: { currentLoginId: string; showHeading?: boolean }) {
  const [currentPassword, setCurrentPassword] = useState("");
  const [newLoginId, setNewLoginId] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  // 서버(lib/security/pii-crypto-core.ts의 normalizeLoginIdentifier)와 같은 정규화를 거쳐야
  // 전각 문자처럼 서버는 정규화 후 통과시킬 입력을 클라이언트 규칙 표시가 먼저 막지 않는다.
  const normalized = newLoginId.trim().normalize("NFKC").toLocaleLowerCase("en-US");
  const rules = {
    length: normalized.length >= 3 && normalized.length <= 20,
    format: /^[a-z0-9]+$/u.test(normalized),
    changed: Boolean(normalized) && normalized !== currentLoginId.trim().normalize("NFKC").toLocaleLowerCase("en-US"),
  };

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPending(true);
    setError("");
    try {
      const response = await fetch("/api/me/login-id", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ currentPassword, newLoginId }),
      });
      const result = await response.json().catch(() => ({ error: "서버 응답을 확인하지 못했습니다." }));
      if (!response.ok) {
        setError(result.error || "로그인 아이디를 변경하지 못했습니다.");
        return;
      }
      await signOut({ callbackUrl: "/login?loginIdChanged=1" });
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "로그인 아이디를 변경하지 못했습니다.");
    } finally {
      setPending(false);
    }
  }

  return (
    <form className="password-change-form" onSubmit={submit}>
      {showHeading ? <div className="password-change-heading">
        <span><UserRound size={18} /></span>
        <div><b>로그인 아이디 변경</b><small>변경하면 모든 기기에서 로그아웃됩니다.</small></div>
      </div> : null}
      <label>현재 비밀번호<input type="password" value={currentPassword} onChange={(event) => setCurrentPassword(event.target.value)} autoComplete="current-password" maxLength={128} required disabled={pending} autoFocus /></label>
      <label>새 로그인 아이디<input type="text" value={newLoginId} onChange={(event) => setNewLoginId(event.target.value)} autoComplete="username" minLength={3} maxLength={20} required disabled={pending} /></label>
      <ul className="auth-password-rules" aria-label="새 아이디 조건">
        <li data-met={rules.length}><Check size={12} />3~20자</li>
        <li data-met={rules.format}><Check size={12} />영문 소문자·숫자</li>
        <li data-met={rules.changed}><Check size={12} />현재 아이디와 다름</li>
      </ul>
      {error ? <p className="form-error" role="alert">{error}</p> : null}
      <button className="button primary full" disabled={pending || !Object.values(rules).every(Boolean)}>{pending ? <><LoaderCircle size={15} className="spin" />변경하는 중…</> : "로그인 아이디 변경"}</button>
    </form>
  );
}
