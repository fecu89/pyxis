import type { ReactNode } from "react";
import type { Metadata } from "next";
import Link from "next/link";
import { LockKeyhole } from "lucide-react";
import { AdminShell } from "@/components/admin/admin-shell";
import { Logo } from "@/components/ui/logo";
import { canAccessAdminShell } from "@/lib/auth/authorization";
import { getCurrentUser } from "@/lib/auth/current-user";
import { redirectToLogin } from "@/lib/auth/page-guard";
import { APP_NAME } from "@/lib/brand";
import { DASHBOARD_PATH } from "@/lib/routes";
import { getAdminCapabilities, toAdminActor } from "@/lib/admin/access";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "관리자 센터" };

/**
 * 관리 콘솔의 인증 게이트.
 *
 * 게이트가 page.tsx에만 있으면 비로그인 요청이 **200으로 응답합니다.** `/admin`은 라우트 그룹
 * 밖이라 위에 아무것도 await하지 않는 루트 레이아웃뿐이고, React가 셸을 먼저 흘려보낸 뒤에야
 * page의 redirect가 도착하기 때문입니다. 그러면 리다이렉트가 RSC 페이로드로만 실려 브라우저는
 * 따라가지만 상태 코드는 200이고, 로그인하지 않은 요청에 페이지 제목과 레이아웃이 나갑니다.
 *
 * 응답이 커밋되기 전에 판정하도록 여기서 사용자 조회를 먼저 합니다. `getCurrentUser`는
 * React cache()라 아래 page.tsx가 다시 불러도 조회는 한 번입니다.
 *
 * 역할 판정(canAccessAdminShell)은 page.tsx가 계속 맡습니다 — 권한이 없는 로그인 사용자에게는
 * 리다이렉트가 아니라 "권한을 요청하세요" 안내를 보여 줘야 하기 때문입니다.
 */
export default async function AdminLayout({ children }: { children: ReactNode }) {
  const user = await getCurrentUser();
  if (!user) redirectToLogin("/admin");
  if (!canAccessAdminShell(user)) {
    return (
      <main className="access-page">
        <nav className="access-nav"><Link href="/" className="brand"><Logo size={29} /><span>{APP_NAME}</span></Link></nav>
        <section className="access-card"><span className="access-icon"><LockKeyhole size={30} /></span><p className="access-eyebrow">ADMIN ACCESS</p><h1>관리자 권한이 필요합니다</h1><p className="access-description">전체관리자에게 필요한 작업 단위 권한을 요청해 주세요. 사용자 목록, 콘텐츠 운영, 감사 로그 권한은 각각 별도로 부여됩니다.</p><div className="access-actions"><Link className="button primary" href={DASHBOARD_PATH}>대시보드로 돌아가기</Link></div></section>
      </main>
    );
  }
  return <AdminShell actor={toAdminActor(user)} access={getAdminCapabilities(user)}>{children}</AdminShell>;
}
