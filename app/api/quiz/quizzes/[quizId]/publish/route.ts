import { requireActiveUser } from "@/lib/auth/authorization";
import { requireManageableQuiz } from "@/lib/quiz/access";
import { apiError, assertSameOrigin } from "@/lib/http";
import { getPrisma } from "@/lib/prisma";
import { questionCompletionError } from "@/lib/quiz/question-schema";

export async function POST(_request: Request, { params }: { params: Promise<{ quizId: string }> }) {
  try {
    assertSameOrigin(_request);
    const actor = await requireActiveUser();
    const { quizId } = await params;
    await requireManageableQuiz(quizId, actor);

    const questions = await getPrisma().question.findMany({
      where: { quizId },
      orderBy: { position: "asc" },
      include: { choices: { orderBy: { position: "asc" } } },
    });
    if (questions.length < 1) {
      throw new Error("문항이 1개 이상 있어야 발행할 수 있습니다.");
    }
    const incompleteIndex = questions.findIndex((question) => questionCompletionError(question));
    if (incompleteIndex >= 0) {
      throw new Error(`${incompleteIndex + 1}번 문항을 완성해 주세요. ${questionCompletionError(questions[incompleteIndex])}`);
    }

    const quiz = await getPrisma().quiz.update({ where: { id: quizId }, data: { isPublished: true } });
    return Response.json({ quiz });
  } catch (error) {
    return apiError(error, "퀴즈를 발행하지 못했습니다.");
  }
}
