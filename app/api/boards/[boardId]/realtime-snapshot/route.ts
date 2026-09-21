import { getCurrentUser } from "@/lib/auth/current-user";
import { getBoardPageData } from "@/lib/board/queries";
import { apiError } from "@/lib/http";
import { getPrisma } from "@/lib/prisma";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * SSE 재연결 또는 멤버·공개 범위 변경 때만 쓰는 수렴용 JSON 스냅샷입니다. 평상시 글·댓글·첨부는
 * 이벤트 델타로 반영하므로 이 무거운 조회가 접속자 수만큼 반복되지 않습니다.
 */
export async function GET(_request: Request, { params }: { params: Promise<{ boardId: string }> }) {
  try {
    const { boardId } = await params;
    const board = await getPrisma().board.findUnique({
      where: { id: boardId },
      select: { id: true, slug: true, deletedAt: true },
    });
    if (!board || board.deletedAt) {
      return Response.json({ error: "패드를 찾을 수 없습니다.", code: "NOT_FOUND" }, { status: 404 });
    }

    const result = await getBoardPageData(board.slug, await getCurrentUser());
    if (result.status !== "ready" || result.data.board.id !== boardId) {
      const status = result.status === "login-required" ? 401 : result.status === "not-found" ? 404 : 403;
      return Response.json(
        { error: "패드 접근 상태가 변경되었습니다.", code: "ACCESS_CHANGED" },
        { status, headers: { "Cache-Control": "private, no-store" } },
      );
    }
    return Response.json(
      { data: result.data },
      { headers: { "Cache-Control": "private, no-store" } },
    );
  } catch (error) {
    return apiError(error, "패드 최신 상태를 불러오지 못했습니다.");
  }
}
