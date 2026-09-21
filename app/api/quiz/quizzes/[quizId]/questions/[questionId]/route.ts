import { z } from "zod";
import { requireActiveUser, AuthorizationError } from "@/lib/auth/authorization";
import { requireManageableQuiz } from "@/lib/quiz/access";
import { apiError, assertSameOrigin } from "@/lib/http";
import { getPrisma } from "@/lib/prisma";
import { assertQuizImageReferences, withQuizImageLock } from "@/lib/quiz/image-store";
import { quizImageUrlSchema } from "@/lib/quiz/question-schema";

const choiceSchema = z.object({
  text: z.string().trim().min(1).max(200),
  isCorrect: z.boolean(),
});

function exactlyOneCorrect(choices: { isCorrect: boolean }[]) {
  return choices.filter((c) => c.isCorrect).length === 1;
}

const patchSchema = z.object({
  type: z.enum(["SINGLE_CHOICE", "TRUE_FALSE", "SHORT_ANSWER"]).optional(),
  text: z.string().trim().min(1).max(500).optional(),
  imageUrl: quizImageUrlSchema.nullable().optional(),
  timeLimitSec: z.number().int().min(5).max(300).optional(),
  points: z.number().int().min(0).max(10000).optional(),
  choices: z.array(choiceSchema).min(2).max(6).optional(),
  acceptedAnswers: z.array(z.string().trim().min(1).max(200)).min(1).max(10).optional(),
});

async function loadOwnedQuestion(quizId: string, questionId: string) {
  const question = await getPrisma().question.findUnique({ where: { id: questionId } });
  if (!question || question.quizId !== quizId) throw new AuthorizationError("문항을 찾을 수 없습니다.");
  return question;
}

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ quizId: string; questionId: string }> },
) {
  try {
    assertSameOrigin(request);
    const actor = await requireActiveUser();
    const { quizId, questionId } = await params;
    await requireManageableQuiz(quizId, actor);
    const existing = await loadOwnedQuestion(quizId, questionId);

    const body = patchSchema.parse(await request.json());
    const effectiveType = body.type ?? existing.type;

    // 유형을 바꾸는 경우, 이전 유형의 보기/정답 목록을 그대로 재사용할 수 없으므로 같은 요청에
    // 새 유형에 맞는 데이터를 함께 요구합니다(어중간한 상태로 저장되는 것을 막기 위함).
    if (body.type && body.type !== existing.type) {
      if ((body.type === "SINGLE_CHOICE" || body.type === "TRUE_FALSE") && !body.choices) {
        throw new Error("유형을 객관식/OX로 바꾸려면 보기도 함께 보내야 합니다.");
      }
      if (body.type === "SHORT_ANSWER" && !body.acceptedAnswers) {
        throw new Error("유형을 주관식으로 바꾸려면 정답 목록도 함께 보내야 합니다.");
      }
    }

    if (body.choices) {
      if (effectiveType === "TRUE_FALSE" && body.choices.length !== 2) {
        throw new Error("OX 문항은 보기가 정확히 2개여야 합니다.");
      }
      if (!exactlyOneCorrect(body.choices)) {
        throw new Error("정답은 정확히 1개여야 합니다.");
      }
    }

    const question = await withQuizImageLock(quizId, async () => {
      await assertQuizImageReferences(quizId, { questionUrls: [body.imageUrl] });
      const prisma = getPrisma();
      return prisma.$transaction(async (tx) => {
        if (effectiveType === "SHORT_ANSWER") {
          await tx.choice.deleteMany({ where: { questionId } });
        } else if (body.choices) {
          await tx.choice.deleteMany({ where: { questionId } });
          await tx.choice.createMany({
            data: body.choices.map((choice, index) => ({
              questionId,
              text: choice.text,
              isCorrect: choice.isCorrect,
              position: index,
            })),
          });
        }

        return tx.question.update({
          where: { id: questionId },
          data: {
            type: body.type,
            text: body.text,
            imageUrl: body.imageUrl,
            timeLimitSec: body.timeLimitSec,
            points: body.points,
            acceptedAnswers: effectiveType === "SHORT_ANSWER" ? body.acceptedAnswers : [],
          },
          include: { choices: { orderBy: { position: "asc" } } },
        });
      });
    });

    return Response.json({ question });
  } catch (error) {
    return apiError(error, "문항을 수정하지 못했습니다.");
  }
}

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ quizId: string; questionId: string }> },
) {
  try {
    assertSameOrigin(_request);
    const actor = await requireActiveUser();
    const { quizId, questionId } = await params;
    await requireManageableQuiz(quizId, actor);
    await loadOwnedQuestion(quizId, questionId);

    const prisma = getPrisma();
    const answeredCount = await prisma.answer.count({ where: { questionId } });
    if (answeredCount > 0) {
      throw new Error("이미 응시 기록이 있는 문항은 삭제할 수 없습니다.");
    }

    await prisma.question.delete({ where: { id: questionId } });
    return Response.json({ ok: true });
  } catch (error) {
    return apiError(error, "문항을 삭제하지 못했습니다.");
  }
}
