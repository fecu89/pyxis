"use client";

import { useEffect, useId, useState, type FormEvent } from "react";
import { signIn } from "next-auth/react";
import { Check, ChevronLeft, Eye, EyeOff } from "lucide-react";
import { DASHBOARD_PATH } from "@/lib/route-paths";
import { useDebouncedCallback } from "@/lib/use-debounced-callback";

const PASSWORD_MIN_LENGTH = 10;

/**
 * 로그인·회원가입 폼.
 *
 * `/login` 페이지와 공개 홈의 모달이 함께 씁니다. 예전에는 이 폼이 `HomeAuthActionsProvider`의
 * 모달 안에 통째로 들어 있어서, 로그인이 필요한 화면들이 `/?login=1&callbackUrl=...`로 홈에
 * 들렀다가 모달을 여는 방식이었습니다. 그러면 로그인 주소를 북마크할 수도 링크로 보낼 수도
 * 없고, 로그인 화면이 마케팅 페이지 렌더링에 얹혀 갑니다.
 *
 * 성공하면 `window.location.assign`으로 이동합니다 — router.push는 클라이언트 캐시를 그대로
 * 두므로 방금 생긴 세션을 layout이 못 봅니다.
 */
export function AuthForm({
  callbackUrl = DASHBOARD_PATH,
  initialError = null,
}: {
  callbackUrl?: string;
  initialError?: string | null;
}) {
  const [mode, setMode] = useState<"login" | "register">("login");
  const [error, setError] = useState(initialError ?? "");
  const [busy, setBusy] = useState<"credentials" | "login-id-check" | "register" | "kakao" | null>(null);
  const [loginId, setLoginId] = useState("");
  const [loginPassword, setLoginPassword] = useState("");
  const [registerLoginId, setRegisterLoginId] = useState("");
  const [registerStep, setRegisterStep] = useState<"login-id" | "password">("login-id");
  const [registerPassword, setRegisterPassword] = useState("");
  const [passwordConfirm, setPasswordConfirm] = useState("");
  const [showRegisterPassword, setShowRegisterPassword] = useState(false);
  const [showPasswordConfirm, setShowPasswordConfirm] = useState(false);
  const [confirmationState, setConfirmationState] = useState<"match" | "mismatch" | null>(null);
  const passwordInputId = useId();
  const confirmInputId = useId();
  const confirmStatusId = useId();
  const authPending = busy !== null;
  const passwordsLongEnough = registerPassword.length >= PASSWORD_MIN_LENGTH && passwordConfirm.length >= PASSWORD_MIN_LENGTH;
  const passwordsMatch = registerPassword === passwordConfirm;
  const { schedule: scheduleConfirmation, cancel: cancelConfirmation } = useDebouncedCallback(
    (password: string, confirmation: string) => setConfirmationState(password === confirmation ? "match" : "mismatch"),
    200,
  );

  // 입력 초반에는 경고하지 않고, 두 값 모두 최소 길이에 도달한 뒤 멈췄을 때만 안내합니다.
  // 가입 가능 여부와 제출 시 검사는 이 지연된 안내 상태를 신뢰하지 않습니다.
  useEffect(() => {
    if (mode !== "register" || registerStep !== "password" || !passwordsLongEnough) return;
    scheduleConfirmation(registerPassword, passwordConfirm);
    return cancelConfirmation;
  }, [mode, registerStep, registerPassword, passwordConfirm, passwordsLongEnough, scheduleConfirmation, cancelConfirmation]);

  async function credentialsLogin(nextLoginId: string, password: string) {
    const result = await signIn("credentials", {
      loginId: nextLoginId,
      password,
      callbackUrl,
      redirect: false,
    });
    if (!result?.ok || result.error) {
      throw new Error("아이디 또는 비밀번호를 확인해 주세요.");
    }
    window.location.assign(callbackUrl);
  }

  async function submitLogin(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    setBusy("credentials");
    try {
      await credentialsLogin(loginId, loginPassword);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "로그인하지 못했습니다.");
      setBusy(null);
    }
  }

  async function submitRegister(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    if (registerStep !== "password") {
      setError("아이디 중복 확인을 먼저 완료해 주세요.");
      return;
    }
    if (registerPassword !== passwordConfirm) {
      setError("비밀번호 확인이 일치하지 않습니다.");
      return;
    }
    setBusy("register");
    try {
      const response = await fetch("/api/auth/register", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          loginId: registerLoginId,
          password: registerPassword,
          passwordConfirm,
        }),
      });
      const result = await response.json().catch(() => null) as { error?: string } | null;
      if (!response.ok) {
        if (response.status === 409) setRegisterStep("login-id");
        throw new Error(result?.error || "회원가입을 완료하지 못했습니다.");
      }
      await credentialsLogin(registerLoginId, registerPassword);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "회원가입을 완료하지 못했습니다.");
      setBusy(null);
    }
  }

  async function checkRegisterLoginId(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    setBusy("login-id-check");
    try {
      const response = await fetch("/api/auth/register/check-login-id", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ loginId: registerLoginId }),
      });
      const result = await response.json().catch(() => null) as { available?: boolean; error?: string } | null;
      if (!response.ok || !result?.available) {
        throw new Error(result?.error || "사용할 수 없는 아이디입니다.");
      }
      setRegisterStep("password");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "아이디 사용 여부를 확인하지 못했습니다.");
    } finally {
      setBusy(null);
    }
  }

  function editRegisterLoginId() {
    setRegisterStep("login-id");
    setRegisterPassword("");
    setPasswordConfirm("");
    setShowRegisterPassword(false);
    setShowPasswordConfirm(false);
    setConfirmationState(null);
    setError("");
  }

  async function kakaoLogin() {
    setError("");
    setBusy("kakao");
    try {
      const result = await signIn("kakao", { callbackUrl });
      if (result?.error) throw new Error("카카오 로그인에 실패했습니다. 잠시 후 다시 시도해 주세요.");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "카카오 로그인에 실패했습니다. 잠시 후 다시 시도해 주세요.");
      setBusy(null);
    }
  }

  return (
    <>
      <div className="auth-tabs" role="tablist" aria-label="로그인 방식">
        <button
          type="button"
          id="auth-login-tab"
          role="tab"
          aria-selected={mode === "login"}
          aria-controls="auth-login-panel"
          onClick={() => { setMode("login"); setShowRegisterPassword(false); setShowPasswordConfirm(false); setConfirmationState(null); setError(""); }}
          disabled={authPending}
        >
          로그인
        </button>
        <button
          type="button"
          id="auth-register-tab"
          role="tab"
          aria-selected={mode === "register"}
          aria-controls="auth-register-panel"
          onClick={() => { setMode("register"); editRegisterLoginId(); }}
          disabled={authPending}
        >
          회원가입
        </button>
      </div>
      {mode === "login" ? (
        <form id="auth-login-panel" className="stack-form auth-form" role="tabpanel" aria-labelledby="auth-login-tab" aria-busy={authPending} onSubmit={submitLogin}>
          <label>아이디<input type="text" value={loginId} onChange={(event) => setLoginId(event.target.value)} autoComplete="username" pattern="[A-Za-z0-9]{3,20}" minLength={3} maxLength={20} spellCheck={false} autoCapitalize="none" required autoFocus disabled={authPending} /></label>
          <label>비밀번호<input type="password" value={loginPassword} onChange={(event) => setLoginPassword(event.target.value)} autoComplete="current-password" maxLength={128} required disabled={authPending} /></label>
          {error && <p className="form-error" role="alert">{error}</p>}
          <button type="submit" className="button primary full" disabled={authPending}>{busy === "credentials" ? "로그인 중…" : "로그인"}</button>
        </form>
      ) : registerStep === "login-id" ? (
        <form id="auth-register-panel" className="stack-form auth-form" role="tabpanel" aria-labelledby="auth-register-tab" aria-busy={authPending} onSubmit={checkRegisterLoginId}>
          <div className="auth-step-heading"><b>사용할 아이디를 정해 주세요</b><span>3~20자 영문자와 숫자만 사용할 수 있습니다.</span></div>
          <label>아이디<input type="text" value={registerLoginId} onChange={(event) => { setRegisterLoginId(event.target.value); setError(""); }} autoComplete="username" pattern="[A-Za-z0-9]{3,20}" minLength={3} maxLength={20} spellCheck={false} autoCapitalize="none" required autoFocus disabled={authPending} /></label>
          {error && <p className="form-error" role="alert">{error}</p>}
          <button type="submit" className="button primary full" disabled={authPending}>{busy === "login-id-check" ? "확인하는 중…" : "아이디 중복 확인"}</button>
        </form>
      ) : (
        <form id="auth-register-panel" className="stack-form auth-form" role="tabpanel" aria-labelledby="auth-register-tab" aria-busy={authPending} onSubmit={submitRegister}>
          <div className="auth-verified-login-id"><span><Check size={15} aria-hidden />사용 가능한 아이디<b>{registerLoginId}</b></span><button type="button" onClick={editRegisterLoginId} disabled={authPending}><ChevronLeft size={14} aria-hidden />변경</button></div>
          <div className="auth-password-field">
            <label htmlFor={passwordInputId}>비밀번호</label>
            <div className="auth-password-control">
              <input
                id={passwordInputId}
                type={showRegisterPassword ? "text" : "password"}
                value={registerPassword}
                onChange={(event) => { setRegisterPassword(event.target.value); setConfirmationState(null); setError(""); }}
                autoComplete="new-password" minLength={PASSWORD_MIN_LENGTH} maxLength={128} required autoFocus disabled={authPending}
              />
              <button
                type="button" className="auth-password-toggle"
                aria-label={showRegisterPassword ? "비밀번호 숨기기" : "비밀번호 보기"}
                aria-pressed={showRegisterPassword} aria-controls={passwordInputId}
                onClick={() => setShowRegisterPassword((visible) => !visible)} disabled={authPending}
              >
                {showRegisterPassword ? <EyeOff size={19} aria-hidden /> : <Eye size={19} aria-hidden />}
              </button>
            </div>
          </div>
          <ul className="auth-password-rules" aria-label="비밀번호 조건">
            <li data-met={registerPassword.length >= PASSWORD_MIN_LENGTH}><Check size={12} aria-hidden />{PASSWORD_MIN_LENGTH}자 이상</li>
            <li data-met={/[A-Za-z]/u.test(registerPassword)}><Check size={12} aria-hidden />영문자</li>
            <li data-met={/[0-9]/u.test(registerPassword)}><Check size={12} aria-hidden />숫자</li>
            <li data-met={/[^A-Za-z0-9\s]/u.test(registerPassword)}><Check size={12} aria-hidden />특수문자</li>
          </ul>
          <div className="auth-password-field">
            <label htmlFor={confirmInputId}>비밀번호 확인</label>
            <div className="auth-password-control">
              <input
                id={confirmInputId}
                type={showPasswordConfirm ? "text" : "password"}
                value={passwordConfirm}
                onChange={(event) => { setPasswordConfirm(event.target.value); setConfirmationState(null); setError(""); }}
                aria-describedby={confirmStatusId} aria-invalid={confirmationState === "mismatch"}
                autoComplete="new-password" minLength={PASSWORD_MIN_LENGTH} maxLength={128} required disabled={authPending}
              />
              <button
                type="button" className="auth-password-toggle"
                aria-label={showPasswordConfirm ? "비밀번호 확인 숨기기" : "비밀번호 확인 보기"}
                aria-pressed={showPasswordConfirm} aria-controls={confirmInputId}
                onClick={() => setShowPasswordConfirm((visible) => !visible)} disabled={authPending}
              >
                {showPasswordConfirm ? <EyeOff size={19} aria-hidden /> : <Eye size={19} aria-hidden />}
              </button>
            </div>
          </div>
          <p id={confirmStatusId} className="auth-password-status" role="status" aria-live="polite" data-valid={confirmationState === "match"}>
            {confirmationState === "mismatch" ? "비밀번호 확인이 일치하지 않습니다." : confirmationState === "match" ? "비밀번호가 일치합니다." : ""}
          </p>
          {error && <p className="form-error" role="alert">{error}</p>}
          <button type="submit" className="button primary full" disabled={authPending || !passwordsLongEnough || !passwordsMatch}>{busy === "register" ? "계정 만드는 중…" : "계정 만들기"}</button>
          <p className="form-hint">계정을 만든 뒤 관리자 승인을 받으면 닉네임과 학교·반 또는 부서를 설정합니다.</p>
        </form>
      )}
      <div className="auth-provider-divider"><span>또는</span></div>
      <div className="auth-provider-actions">
        <button type="button" className="button kakao full" onClick={kakaoLogin} disabled={authPending} aria-label="카카오로 계속하기">
          <svg viewBox="0 0 86.78 91.78" aria-hidden>
            <path fill="currentColor" d="M43.39 0C19.43 0 0 17.97 0 40.13c0 16.37 6.86 24.19 16.25 31.31l.04.02v19.21c0 .91 1.04 1.43 1.76.88L34.5 79.33l.36.15c2.76.51 5.61.78 8.53.78 23.96 0 43.39-17.97 43.39-40.14S67.36 0 43.39 0" />
          </svg>
          {busy === "kakao" ? "카카오로 이동 중…" : "카카오로 계속하기"}
        </button>
        <p className="form-hint">카카오는 검증된 이메일과 프로필 정보를 연결하며, 최초 연결은 관리자 승인 후 사용할 수 있습니다.</p>
      </div>
    </>
  );
}
