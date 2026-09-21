import Link from "next/link";
import { ArrowLeft, Files, LockKeyhole } from "lucide-react";
import { notFound, redirect } from "next/navigation";
import { PadReuseDialog } from "@/components/home/pad-reuse-dialog";
import { getCurrentUser } from "@/lib/auth/current-user";
import { loginRedirectPath } from "@/lib/auth/page-guard";
import { getCopyLinkData } from "@/lib/board-reuse/queries";
import { APP_NAME } from "@/lib/brand";
import styles from "./copy-page.module.css";

export const dynamic = "force-dynamic";

export default async function CopyBoardPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const user = await getCurrentUser();
  const data = await getCopyLinkData(slug, user);
  if (data.status === "login-required") redirect(loginRedirectPath(`/b/${slug}/copy`));
  if (data.status === "not-found") notFound();

  if (data.status !== "ok") {
    const passwordRequired = data.status === "password-required";
    return (
      <main className={styles.page}>
        <section className={styles.notice}>
          <span className={styles.icon}><LockKeyhole size={24} aria-hidden /></span>
          <span className={styles.eyebrow}>COPY LINK</span>
          <h1>{data.status === "create-forbidden" ? "패드를 만들 수 있는 역할이 필요합니다" : passwordRequired ? "먼저 패드 비밀번호를 확인해 주세요" : "원본 패드 접근 권한이 필요합니다"}</h1>
          <p>{data.status === "create-forbidden" ? "패드 복제는 교사·관리자 역할에서 사용할 수 있습니다." : passwordRequired ? "원본 패드를 열어 비밀번호를 확인한 뒤 이 복제 링크로 돌아오세요." : "원본 패드 소유자에게 초대 또는 접근 승인을 요청한 뒤 다시 시도해 주세요."}</p>
          <div className={styles.noticeActions}>
            <Link href="/" className={styles.secondary}><ArrowLeft size={16} aria-hidden />홈으로</Link>
            {data.status !== "create-forbidden" && <Link href={`/b/${slug}`} className={styles.primary}>원본 패드 열기</Link>}
          </div>
        </section>
      </main>
    );
  }

  return (
    <main className={styles.page}>
      <header className={styles.topbar}><Link href={`/b/${slug}`}><ArrowLeft size={16} aria-hidden />원본 패드</Link><span><Files size={16} aria-hidden />{APP_NAME} 복제</span></header>
      <PadReuseDialog board={data.board} embedded />
    </main>
  );
}
