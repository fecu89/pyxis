import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getCurrentUser } from "@/lib/auth/current-user";
import { redirectToLogin } from "@/lib/auth/page-guard";
import { getBoardPageData } from "@/lib/board/queries";
import { boardRoutePath, decodeBoardRouteSlug } from "@/lib/board/route-paths";
import { gatherBoardExportData } from "@/lib/exports/data";
import { PadAccessGate } from "@/components/pad/pad-access-gate";
import { PadPasswordGate } from "@/components/pad/pad-password-gate";
import { PadPresentation } from "@/components/pad/export/pad-presentation";
import { buildBoardPageMetadata } from "@/utils/seo/boardMetadata";

export const dynamic = "force-dynamic";

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const { slug: encodedSlug } = await params;
  const slug = decodeBoardRouteSlug(encodedSlug);
  return buildBoardPageMetadata(slug, { pageLabel: "발표 모드", pathSuffix: "/present", alwaysNoIndex: true });
}

// 접근 판정은 보드 페이지와 같은 getBoardPageData를 그대로 쓰고, 슬라이드 목록은 댓글·반응 없이
// 게시된 글만 싣는 가벼운 내보내기 DTO로 별도 조회합니다.
export default async function BoardPresentPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug: encodedSlug } = await params;
  const slug = decodeBoardRouteSlug(encodedSlug);
  const currentUser = await getCurrentUser();
  // 발표 슬라이드는 화면용 첫 페이지가 아니라 패드 전체 글을 순회합니다.
  const result = await getBoardPageData(slug, currentUser, { allPosts: true });
  if (result.status === "login-required") {
    redirectToLogin(`${boardRoutePath(slug)}/present`);
  }
  if (result.status === "not-found") notFound();
  if (result.status === "access-required") {
    return <PadAccessGate {...result.data} />;
  }
  if (result.status === "password-required") {
    return <PadPasswordGate {...result.data} />;
  }
  // 발표 모드는 첨부(이미지)만 보여주고 댓글은 화면에 안 쓰므로 댓글 관계를 안 켭니다.
  const exportData = await gatherBoardExportData(result.data.board.id, "PUBLISHED", false);
  return <PadPresentation boardTitle={result.data.board.title} boardSlug={result.data.board.slug} posts={exportData.posts} />;
}
