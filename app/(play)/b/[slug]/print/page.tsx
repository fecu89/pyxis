import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getCurrentUser } from "@/lib/auth/current-user";
import { redirectToLogin } from "@/lib/auth/page-guard";
import { getBoardPageData } from "@/lib/board/queries";
import { boardRoutePath, decodeBoardRouteSlug } from "@/lib/board/route-paths";
import { PadAccessGate } from "@/components/pad/pad-access-gate";
import { PadPasswordGate } from "@/components/pad/pad-password-gate";
import { PadPrintView } from "@/components/pad/export/pad-print-view";
import { buildBoardPageMetadata } from "@/utils/seo/boardMetadata";

export const dynamic = "force-dynamic";

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const { slug: encodedSlug } = await params;
  const slug = decodeBoardRouteSlug(encodedSlug);
  return buildBoardPageMetadata(slug, { pageLabel: "인쇄", pathSuffix: "/print", alwaysNoIndex: true });
}

// 게시물·읽기 권한 판정은 보드 페이지와 완전히 같은 getBoardPageData를 그대로 재사용합니다
// (padupgrade.md 8.3: 내보내기도 보드 읽기 권한을 그대로 검사).
export default async function BoardPrintPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug: encodedSlug } = await params;
  const slug = decodeBoardRouteSlug(encodedSlug);
  const currentUser = await getCurrentUser();
  // 인쇄는 화면용 첫 페이지가 아니라 패드 전체가 결과물이어야 합니다.
  const result = await getBoardPageData(slug, currentUser, { allPosts: true });
  if (result.status === "login-required") {
    redirectToLogin(`${boardRoutePath(slug)}/print`);
  }
  if (result.status === "not-found") notFound();
  if (result.status === "access-required") {
    return <PadAccessGate {...result.data} />;
  }
  if (result.status === "password-required") {
    return <PadPasswordGate {...result.data} />;
  }
  return <PadPrintView board={result.data.board} />;
}
