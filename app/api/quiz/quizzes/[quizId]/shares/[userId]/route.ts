import { requireActiveUser } from "@/lib/auth/authorization";
import { apiError, assertSameOrigin } from "@/lib/http";
import { getPrisma } from "@/lib/prisma";
import { requireOwnedQuiz } from "@/lib/quiz/access";

export async function DELETE(request: Request, { params }: { params: Promise<{ quizId: string; userId: string }> }) {
  try {
    assertSameOrigin(request);
    const actor = await requireActiveUser();
    const { quizId, userId } = await params;
    await requireOwnedQuiz(quizId, actor);
    await getPrisma().quizShare.deleteMany({ where: { quizId, userId } });
    return Response.json({ ok: true });
  } catch (error) {
    return apiError(error, "공유 권한을 제거하지 못했습니다.");
  }
}
