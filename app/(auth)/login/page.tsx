import Link from "next/link";
import { redirect } from "next/navigation";
import { AuthForm } from "@/components/auth/auth-form";
import { Logo } from "@/components/ui/logo";
import { ThemeToggle } from "@/components/ui/theme-toggle";
import { getCurrentUser } from "@/lib/auth/current-user";
import { safeInternalCallbackUrl } from "@/lib/auth/callback-url";
import { DASHBOARD_PATH, PUBLIC_HOME_PATH } from "@/lib/routes";
import { APP_NAME } from "@/lib/brand";
import { getMetadata } from "@/utils/seo/getMetadata";

export const metadata = getMetadata({
  title: "로그인",
  description: `${APP_NAME}에 로그인하거나 새 계정을 만듭니다.`,
  asPath: "/login",
  // 로그인 화면은 색인할 이유가 없고, callbackUrl이 붙은 주소가 검색에 남으면 안 됩니다.
  noIndex: true,
});

type LoginSearchParams = { error?: string | string[]; callbackUrl?: string | string[] };

function first(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value;
}

function authErrorMessage(error: string | undefined) {
  if (!error) return null;
  if (error === "AccessDenied") return "카카오 계정의 이메일 제공 동의가 필요합니다.";
  return "카카오 로그인에 실패했습니다. 잠시 후 다시 시도해 주세요.";
}

/**
 * 로그인 화면. 로그인이 필요한 모든 화면이 여기로 보냅니다(`lib/auth/page-guard.ts`).
 *
 * 이미 로그인한 상태로 오면 원래 가려던 곳으로 넘깁니다 — 되돌아온 사용자가 자기 세션이
 * 끊긴 줄 알게 되는 걸 막습니다.
 */
export default async function LoginPage({ searchParams }: { searchParams: Promise<LoginSearchParams> }) {
  const params = await searchParams;
  const callbackUrl = safeInternalCallbackUrl(first(params.callbackUrl), DASHBOARD_PATH);
  const user = await getCurrentUser();
  if (user) redirect(callbackUrl);

  return (
    <main className="auth-page">
      <div className="auth-page-card">
        <div className="auth-page-heading">
          <Link href={PUBLIC_HOME_PATH} className="auth-page-brand" aria-label={`${APP_NAME} 홈`}>
            <Logo size={32} />
            <span>{APP_NAME}</span>
          </Link>
          <ThemeToggle />
        </div>
        <h1>{APP_NAME} 시작하기</h1>
        <p>아이디 계정을 만들거나 카카오로 계속할 수 있어요.</p>
        <AuthForm callbackUrl={callbackUrl} initialError={authErrorMessage(first(params.error))} />
      </div>
    </main>
  );
}
