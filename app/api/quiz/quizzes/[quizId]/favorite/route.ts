import { requireActiveUser } from "@/lib/auth/authorization";
import { apiError, assertSameOrigin } from "@/lib/http";
import { getPrisma } from "@/lib/prisma";
import { requireViewableQuiz } from "@/lib/quiz/access";

export async function PUT(request: Request, { params }: { params: Promise<{ quizId: string }> }) {
  try {
    assertSameOrigin(request);
    const actor = await requireActiveUser();
    const { quizId } = await params;
    await requireViewableQuiz(quizId, actor);
    await getPrisma().quizFavorite.upsert({
      where: { userId_quizId: { userId: actor.id, quizId } },
      create: { userId: actor.id, quizId },
      update: {},
    });
    return Response.json({ favorite: true });
  } catch (error) {
    return apiError(error, "즐겨찾기에 추가하지 못했습니다.");
  }
}

export async function DELETE(request: Request, { params }: { params: Promise<{ quizId: string }> }) {
  try {
    assertSameOrigin(request);
    const actor = await requireActiveUser();
    const { quizId } = await params;
    await getPrisma().quizFavorite.deleteMany({ where: { userId: actor.id, quizId } });
    return Response.json({ favorite: false });
  } catch (error) {
    return apiError(error, "즐겨찾기에서 제거하지 못했습니다.");
  }
}
