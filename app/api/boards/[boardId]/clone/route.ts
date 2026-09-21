import { requireActiveUser } from "@/lib/auth/authorization";
import { BoardReuseError, cloneBoard } from "@/lib/board-reuse/clone-board";
import { cloneBoardSchema } from "@/lib/board-reuse/validators";
import { apiError, assertSameOrigin } from "@/lib/http";

export const runtime = "nodejs";
export const maxDuration = 120;

export async function POST(request: Request, { params }: { params: Promise<{ boardId: string }> }) {
  try {
    assertSameOrigin(request);
    const user = await requireActiveUser();
    const { boardId } = await params;
    const parsed = cloneBoardSchema.safeParse(await request.json());
    if (!parsed.success) return Response.json({ error: parsed.error.issues[0]?.message ?? "복제 옵션을 확인해 주세요." }, { status: 400 });
    const board = await cloneBoard(boardId, user, parsed.data);
    return Response.json({ board }, { status: 201 });
  } catch (error) {
    if (error instanceof BoardReuseError) return Response.json({ error: error.message }, { status: error.status });
    return apiError(error, "패드를 복제하지 못했습니다.");
  }
}
