import Link from "next/link";
import { getCurrentUser } from "@/lib/auth/current-user";
import { redirectToLogin } from "@/lib/auth/page-guard";
import { hashInviteToken } from "@/lib/board/invite-links";
import { getPrisma } from "@/lib/prisma";
import { JoinBoardButton } from "@/components/invite/join-board-button";

export const dynamic = "force-dynamic";

async function loadInvite(token: string) {
  const invite = await getPrisma().boardInviteLink.findUnique({
    where: { tokenHash: hashInviteToken(token) },
    select: {
      revokedAt: true,
      expiresAt: true,
      maxUses: true,
      useCount: true,
      board: { select: { slug: true, title: true, description: true, deletedAt: true } },
    },
  });
  if (!invite || invite.revokedAt || invite.board.deletedAt) return { status: "invalid" as const };
  if (invite.expiresAt && invite.expiresAt.getTime() < Date.now()) return { status: "expired" as const };
  if (invite.maxUses !== null && invite.useCount >= invite.maxUses) return { status: "exhausted" as const };
  return { status: "valid" as const, board: invite.board };
}

export default async function InvitePage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const result = await loadInvite(token);

  if (result.status !== "valid") {
    const message = result.status === "expired" ? "만료된 초대 링크입니다." : result.status === "exhausted" ? "사용 횟수를 초과한 초대 링크입니다." : "유효하지 않은 초대 링크입니다.";
    return (
      <main className="access-page">
        <section className="access-card">
          <h1>참여할 수 없어요</h1>
          <p className="access-description">{message}</p>
          <Link className="button primary" href="/">홈으로</Link>
        </section>
      </main>
    );
  }

  const user = await getCurrentUser();
  if (!user) redirectToLogin(`/i/${token}`);

  return (
    <main className="access-page">
      <section className="access-card">
        <p className="access-eyebrow">패드 초대</p>
        <h1>{result.board.title}</h1>
        {result.board.description && <p className="access-description">{result.board.description}</p>}
        <JoinBoardButton token={token} />
      </section>
    </main>
  );
}
