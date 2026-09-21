import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { after } from "next/server";
import { getCurrentUser } from "@/lib/auth/current-user";
import { redirectToLogin } from "@/lib/auth/page-guard";
import { getBoardPageData } from "@/lib/board/queries";
import { boardRoutePath, decodeBoardRouteSlug } from "@/lib/board/route-paths";
import { PadAccessGate } from "@/components/pad/pad-access-gate";
import { GuestIdentityProvider } from "@/components/pad/guest-identity";
import { PadCanvas } from "@/components/pad/pad-canvas";
import { PadPasswordGate } from "@/components/pad/pad-password-gate";
import { AppShell } from "@/components/shell/app-shell";
import { recordBoardVisit } from "@/lib/dashboard/visits";
import { buildBoardPageMetadata } from "@/utils/seo/boardMetadata";
import { getNotificationSummary } from "@/lib/notifications/list";

export const dynamic = "force-dynamic";

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const { slug: encodedSlug } = await params;
  const slug = decodeBoardRouteSlug(encodedSlug);
  return buildBoardPageMetadata(slug);
}

export default async function BoardPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug: encodedSlug } = await params;
  const slug = decodeBoardRouteSlug(encodedSlug);
  const currentUser = await getCurrentUser();
  const [result, notifications] = await Promise.all([
    getBoardPageData(slug, currentUser),
    currentUser ? getNotificationSummary(currentUser.id) : Promise.resolve(null),
  ]);
  if (result.status === "login-required") {
    redirectToLogin(boardRoutePath(slug));
  }
  if (result.status === "not-found") notFound();
  if (result.status === "access-required") {
    return <PadAccessGate {...result.data} />;
  }
  if (result.status === "password-required") {
    return <PadPasswordGate {...result.data} />;
  }
  if (currentUser) {
    after(() => recordBoardVisit(result.data.board.id, currentUser.id));
  }
  return (
    <AppShell showSidebar={false}>
      <GuestIdentityProvider boardId={result.data.board.id} viewer={result.data.viewer}>
        <PadCanvas
          key={`${result.data.board.id}:${result.data.board.state}:${result.data.board.freezeAt ?? "none"}`}
          initialData={result.data}
          currentUserId={currentUser?.id ?? null}
          initialFrozen={result.data.initialFrozen}
          initialNotifications={notifications}
        />
      </GuestIdentityProvider>
    </AppShell>
  );
}
