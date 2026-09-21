import { requireActiveUser, requireRecentAuthentication } from "@/lib/auth/authorization";
import { createAuditLogData } from "@/lib/auth/audit";
import { decryptBoardPasswordSecret } from "@/lib/board/board-password";
import { apiError, assertSameOrigin } from "@/lib/http";
import { getPrisma } from "@/lib/prisma";
import { assertRateLimit } from "@/lib/security/rate-limit";

const PRIVATE_NO_STORE = { "Cache-Control": "private, no-store" } as const;

export async function POST(request: Request, { params }: { params: Promise<{ boardId: string }> }) {
  try {
    assertSameOrigin(request);
    const user = await requireActiveUser();
    await requireRecentAuthentication(user, 30);
    const { boardId } = await params;
    assertRateLimit(request, {
      scope: `board-password-reveal:${boardId}`,
      userId: user.id,
      windowMs: 10 * 60_000,
      maxAttempts: 5,
      message: "비밀번호 확인 요청이 너무 잦습니다. 잠시 후 다시 시도해 주세요.",
    });
    const board = await getPrisma().board.findFirst({
      where: { id: boardId, deletedAt: null },
      select: { ownerId: true, passwordHash: true, passwordEncrypted: true },
    });

    if (!board) return Response.json({ error: "패드를 찾을 수 없습니다." }, { status: 404, headers: PRIVATE_NO_STORE });
    // 전체관리자나 패드 ADMIN도 공유 비밀번호 원문은 볼 수 없습니다. 오직 현재 소유자만 봅니다.
    if (board.ownerId !== user.id) return Response.json({ error: "패드 소유자만 비밀번호를 확인할 수 있습니다." }, { status: 403, headers: PRIVATE_NO_STORE });
    if (!board.passwordHash) return Response.json({ error: "설정된 비밀번호가 없습니다." }, { status: 409, headers: PRIVATE_NO_STORE });
    if (!board.passwordEncrypted) {
      return Response.json({ error: "기존 비밀번호는 확인할 수 없습니다. 새 비밀번호로 한 번 변경해 주세요." }, { status: 409, headers: PRIVATE_NO_STORE });
    }

    const password = decryptBoardPasswordSecret(boardId, board.passwordEncrypted);
    await getPrisma().adminAuditLog.create({
      data: createAuditLogData({
        actorId: user.id,
        action: "BOARD_PASSWORD_VIEWED",
        entityType: "Board",
        entityId: boardId,
      }),
    });
    return Response.json({ password }, { headers: PRIVATE_NO_STORE });
  } catch (error) {
    return apiError(error, "비밀번호를 불러오지 못했습니다.");
  }
}
