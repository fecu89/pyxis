import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { PasswordChangeForm } from "@/components/home/password-change-form";
import { Logo } from "@/components/ui/logo";
import { getCurrentUser } from "@/lib/auth/current-user";
import { DASHBOARD_PATH } from "@/lib/routes";
import { redirectToLogin } from "@/lib/auth/page-guard";
import { APP_NAME } from "@/lib/brand";

export const metadata: Metadata = { title: "새 비밀번호 설정" };
export const dynamic = "force-dynamic";

export default async function ChangePasswordPage() {
  const user = await getCurrentUser();
  if (!user) redirectToLogin("/change-password");
  if (!user.mustChangePassword) redirect(DASHBOARD_PATH);
  if (!user.hasPasswordCredential) redirect(DASHBOARD_PATH);
  return (
    <main className="forced-password-page">
      <nav><Link href="/" className="brand"><Logo size={29} /><span>{APP_NAME}</span></Link></nav>
      <section className="forced-password-card">
        <p className="access-eyebrow">FIRST SIGN-IN</p>
        <h1>처음 로그인하셨군요.</h1>
        <p>계정을 안전하게 사용하려면 관리자에게 받은 초기 비밀번호를 본인만의 비밀번호로 바꿔 주세요.</p>
        <PasswordChangeForm forced />
      </section>
    </main>
  );
}
