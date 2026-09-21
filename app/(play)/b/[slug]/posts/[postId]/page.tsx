import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { after } from "next/server";
import { PadAccessGate } from "@/components/pad/pad-access-gate";
import { GuestIdentityProvider } from "@/components/pad/guest-identity";
import { PostDetailPage } from "@/components/pad/post-detail";
import { PadPasswordGate } from "@/components/pad/pad-password-gate";
import { AppShell } from "@/components/shell/app-shell";
import { getCurrentUser } from "@/lib/auth/current-user";
import { redirectToLogin } from "@/lib/auth/page-guard";
import { getBoardPageData } from "@/lib/board/queries";
import { boardPostRoutePath, decodeBoardRouteSlug } from "@/lib/board/route-paths";
import { recordBoardVisit } from "@/lib/dashboard/visits";
import { buildBoardPostPageMetadata } from "@/utils/seo/boardMetadata";

export const dynamic = "force-dynamic";

function decodeRoutePostId(value: string) {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string; postId: string }>;
}): Promise<Metadata> {
  const { slug: encodedSlug, postId: encodedPostId } = await params;
  return buildBoardPostPageMetadata(
    decodeBoardRouteSlug(encodedSlug),
    decodeRoutePostId(encodedPostId),
  );
}

export default async function PostPage({
  params,
}: {
  params: Promise<{ slug: string; postId: string }>;
}) {
  const { slug: encodedSlug, postId: encodedPostId } = await params;
  const slug = decodeBoardRouteSlug(encodedSlug);
  const postId = decodeRoutePostId(encodedPostId);
  const detailHref = boardPostRoutePath(slug, postId);
  const currentUser = await getCurrentUser();
  const result = await getBoardPageData(slug, currentUser, { focusPostId: postId });

  if (result.status === "login-required") redirectToLogin(detailHref);
  if (result.status === "not-found") notFound();
  if (result.status === "access-required") return <PadAccessGate {...result.data} />;
  if (result.status === "password-required") return <PadPasswordGate {...result.data} />;

  const section = result.data.board.sections.find((candidate) => candidate.posts.some((post) => post.id === postId));
  const post = section?.posts.find((candidate) => candidate.id === postId);
  if (!section || !post) notFound();

  if (currentUser) {
    after(() => recordBoardVisit(result.data.board.id, currentUser.id));
  }

  return (
    <AppShell showSidebar={false}>
      <GuestIdentityProvider boardId={result.data.board.id} viewer={result.data.viewer}>
        <PostDetailPage
          board={result.data.board}
          section={section}
          post={post}
          capabilities={result.data.capabilities}
          currentUserId={currentUser?.id ?? null}
        />
      </GuestIdentityProvider>
    </AppShell>
  );
}
