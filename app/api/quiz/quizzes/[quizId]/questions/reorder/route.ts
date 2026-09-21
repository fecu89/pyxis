import { z } from "zod";
import { requireActiveUser } from "@/lib/auth/authorization";
import { requireManageableQuiz } from "@/lib/quiz/access";
import { apiError, assertSameOrigin } from "@/lib/http";
import { readJsonWithLimit } from "@/lib/http-json";
import { getPrisma } from "@/lib/prisma";

const bodySchema = z.object({ order: z.array(z.string().min(1)).min(1).max(100) });
const REORDER_BODY_MAX_BYTES = 64 * 1024;

export async function PATCH(request: Request, { params }: { params: Promise<{ quizId: string }> }) {
  try {
    assertSameOrigin(request);
    const actor = await requireActiveUser();
    const { quizId } = await params;
    await requireManageableQuiz(quizId, actor);

    const { order } = bodySchema.parse(await readJsonWithLimit(request, REORDER_BODY_MAX_BYTES));
    const prisma = getPrisma();

    const existing = await prisma.question.findMany({ where: { quizId }, select: { id: true } });
    const existingIds = new Set(existing.map((q) => q.id));
    if (order.length !== existing.length || !order.every((id) => existingIds.has(id))) {
      throw new Error("문항 목록이 일치하지 않습니다.");
    }

    await prisma.$transaction(
      order.map((questionId, index) =>
        prisma.question.update({ where: { id: questionId }, data: { position: index } }),
      ),
    );

    return Response.json({ ok: true });
  } catch (error) {
    return apiError(error, "문항 순서를 변경하지 못했습니다.");
  }
}
