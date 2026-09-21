import { z } from "zod";
import { getBoardPasswordClientId, markBoardPasswordVerified, verifyBoardPassword } from "@/lib/board/board-password";
import { apiError, assertSameOrigin } from "@/lib/http";
import { readJsonWithLimit } from "@/lib/http-json";
import { getPrisma } from "@/lib/prisma";
import { createRateLimiter, clientIp, RateLimitError } from "@/lib/security/rate-limit";
import { hasTrustedClientIp } from "@/lib/security/request-identity";

const schema = z.object({ password: z.string().min(1).max(256) });
const PASSWORD_BODY_MAX_BYTES = 16 * 1024;
const FAILURE_WINDOW_MS = 10 * 60_000;
const clientFailureLimiter = createRateLimiter({ windowMs: FAILURE_WINDOW_MS, maxAttempts: 8 });
const ipFailureLimiter = createRateLimiter({ windowMs: FAILURE_WINDOW_MS, maxAttempts: 60 });

function assertPasswordAttemptsAvailable(clientKey: string, ipKey: string | null) {
  const decisions = [clientFailureLimiter.peek(clientKey), ...(ipKey ? [ipFailureLimiter.peek(ipKey)] : [])];
  const blocked = decisions.find((decision) => !decision.allowed);
  if (blocked) {
    throw new RateLimitError("비밀번호 시도가 너무 많습니다. 잠시 후 다시 시도해 주세요.", blocked.retryAfterSeconds);
  }
}

// 교실은 한 공인 IP를 공유하므로 브라우저별 실패 제한을 주 경계로 쓰고 IP 제한은 더 느슨한
// 전체 방어선으로 둡니다. 성공 요청은 실패 한도를 소비하지 않습니다.
export async function POST(request: Request, { params }: { params: Promise<{ boardId: string }> }) {
  try {
    assertSameOrigin(request);
    const { boardId } = await params;
    const clientKey = `${boardId}|browser:${await getBoardPasswordClientId()}`;
    const ipKey = hasTrustedClientIp() ? `${boardId}|ip:${clientIp(request)}` : null;
    assertPasswordAttemptsAvailable(clientKey, ipKey);
    const parsed = schema.safeParse(await readJsonWithLimit(request, PASSWORD_BODY_MAX_BYTES));
    if (!parsed.success) return Response.json({ error: "비밀번호를 입력해 주세요." }, { status: 400 });

    const board = await getPrisma().board.findFirst({
      where: { id: boardId, deletedAt: null },
      select: { passwordHash: true },
    });
    if (!board) return Response.json({ error: "패드를 찾을 수 없습니다." }, { status: 404 });
    if (!board.passwordHash) return Response.json({ ok: true });
    if (!await verifyBoardPassword(parsed.data.password, board.passwordHash)) {
      clientFailureLimiter.check(clientKey);
      if (ipKey) ipFailureLimiter.check(ipKey);
      return Response.json({ error: "비밀번호가 올바르지 않습니다." }, { status: 403 });
    }
    clientFailureLimiter.reset(clientKey);
    await markBoardPasswordVerified(boardId, board.passwordHash);
    return Response.json({ ok: true });
  } catch (error) {
    return apiError(error, "비밀번호를 확인하지 못했습니다.");
  }
}
