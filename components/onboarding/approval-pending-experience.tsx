"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { SessionProvider, signOut, useSession } from "next-auth/react";
import { Building2, CheckCircle2, Clock3, LoaderCircle, LogOut, RefreshCw, School, ShieldCheck } from "lucide-react";
import { Avatar } from "@/components/ui/avatar";
import { Logo } from "@/components/ui/logo";
import { ThemeToggle } from "@/components/ui/theme-toggle";
import { APP_NAME } from "@/lib/brand";
import styles from "@/components/onboarding/approval-pending.module.css";

type ApprovalPendingProps = {
  mode: "ACCOUNT" | "TEACHER";
  name: string | null;
  loginIdentifier: string;
  image: string | null;
  schoolName?: string;
  departmentName?: string;
  requestedAtLabel: string;
  rejected?: boolean;
  reviewReason?: string | null;
  nextPath: string;
};

export function ApprovalPendingExperience(props: ApprovalPendingProps) {
  return (
    <SessionProvider refetchInterval={15} refetchOnWindowFocus>
      <ApprovalPendingContent {...props} />
    </SessionProvider>
  );
}

function ApprovalPendingContent({
  name,
  loginIdentifier,
  image,
  schoolName,
  departmentName,
  requestedAtLabel,
  nextPath,
  mode,
  rejected = false,
  reviewReason,
}: ApprovalPendingProps) {
  const { data: session, update: updateSession } = useSession();
  const [pending, setPending] = useState<"refresh" | "logout" | null>(null);
  const [message, setMessage] = useState("");

  useEffect(() => {
    const state = session?.user?.onboardingState;
    if (state === "COMPLETE") window.location.replace(nextPath);
    if (state === "PROFILE") {
      window.location.replace(`/onboarding?next=${encodeURIComponent(nextPath)}`);
    }
  }, [nextPath, session?.user?.onboardingState]);

  async function refreshStatus() {
    setPending("refresh");
    setMessage("");
    try {
      const nextSession = await updateSession();
      if (nextSession?.user?.onboardingState === "TEACHER_PENDING" || nextSession?.user?.onboardingState === "ACCOUNT_PENDING") {
        setMessage("아직 승인 대기 중입니다. 승인되면 이 화면이 자동으로 전환됩니다.");
      } else if (nextSession?.user?.onboardingState === "ACCOUNT_REJECTED") {
        setMessage("가입 요청이 반려되었습니다. 아래 사유를 확인해 주세요.");
      }
    } catch {
      setMessage("승인 상태를 확인하지 못했습니다. 잠시 후 다시 시도해 주세요.");
    } finally {
      setPending(null);
    }
  }

  async function logout() {
    setPending("logout");
    await signOut({ callbackUrl: "/" });
  }

  return (
    <main className={styles.page}>
      <nav className={styles.nav}>
        <Link href="/approval-pending" className={styles.brand} aria-label={`${APP_NAME} 가입 승인 대기`}>
          <Logo size={27} /><b>{APP_NAME}</b>
        </Link>
        <ThemeToggle />
      </nav>

      <section className={styles.card}>
        <div className={styles.statusIcon}>{rejected ? <ShieldCheck size={30} aria-hidden /> : <Clock3 size={30} aria-hidden />}</div>
        <span className={styles.eyebrow}>{mode === "TEACHER" ? "TEACHER VERIFICATION" : "ACCOUNT VERIFICATION"}</span>
        <h1>{rejected ? <>가입 요청이<br />반려되었어요.</> : <>관리자가<br />가입 요청을 확인하고 있어요.</>}</h1>
        <p className={styles.description}>{rejected
          ? "확인이 필요한 내용을 반려 사유에서 확인한 뒤 관리자에게 문의해 주세요."
          : mode === "TEACHER"
            ? "승인이 완료되면 교사 권한과 선택한 소속이 연결됩니다. 브라우저를 닫아도 신청과 승인 결과는 그대로 유지돼요."
            : "승인이 완료되면 프로필과 학교 정보를 설정할 수 있습니다. 브라우저를 닫아도 신청 상태는 그대로 유지돼요."}</p>

        <div className={styles.profile}>
          <Avatar name={name} identifier={loginIdentifier} image={image} size="medium" />
          <span><b>{name || (mode === "TEACHER" ? "교사 신청자" : "가입 신청자")}</b><small>{loginIdentifier}</small></span>
        </div>

        <dl className={styles.summary}>
          {schoolName && <div><dt><School size={16} aria-hidden />학교</dt><dd>{schoolName}</dd></div>}
          {departmentName && <div><dt><Building2 size={16} aria-hidden />부서</dt><dd>{departmentName}</dd></div>}
          <div><dt><Clock3 size={16} aria-hidden />신청 시각</dt><dd>{requestedAtLabel}</dd></div>
          {rejected && reviewReason && <div><dt><ShieldCheck size={16} aria-hidden />반려 사유</dt><dd>{reviewReason}</dd></div>}
        </dl>

        <div className={styles.process}>
          <span data-done="true"><CheckCircle2 size={15} aria-hidden /><b>신청 완료</b></span>
          <i />
          <span data-active={!rejected ? "true" : undefined}><Clock3 size={15} aria-hidden /><b>관리자 확인</b></span>
          <i />
          <span><ShieldCheck size={15} aria-hidden /><b>{mode === "TEACHER" ? "교사 권한 연결" : "계정 사용 시작"}</b></span>
        </div>

        {message && <p className={styles.message} role="status">{message}</p>}
        <div className={styles.actions}>
          {!rejected && <button type="button" className="button primary" disabled={pending !== null} onClick={() => void refreshStatus()}>
            {pending === "refresh" ? <LoaderCircle size={16} className="spin" aria-hidden /> : <RefreshCw size={16} aria-hidden />}
            승인 상태 확인
          </button>}
          <button type="button" className="button ghost" disabled={pending !== null} onClick={() => void logout()}>
            <LogOut size={16} aria-hidden />{pending === "logout" ? "로그아웃 중…" : "다른 계정으로 로그인"}
          </button>
        </div>
      </section>
    </main>
  );
}
