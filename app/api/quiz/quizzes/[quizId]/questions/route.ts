import { z } from "zod";
import { requireActiveUser } from "@/lib/auth/authorization";
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

const baseFields = {
  text: z.string().trim().min(1).max(500),
  imageUrl: quizImageUrlSchema.optional(),
  timeLimitSec: z.number().int().min(5).max(300).optional(),
  points: z.number().int().min(0).max(10000).optional(),
};

const singleChoiceSchema = z.object({
  type: z.literal("SINGLE_CHOICE"),
  ...baseFields,
  choices: z.array(choiceSchema).min(2).max(6).refine(exactlyOneCorrect, { message: "정답은 정확히 1개여야 합니다." }),
});

const trueFalseSchema = z.object({
  type: z.literal("TRUE_FALSE"),
  ...baseFields,
  choices: z.array(choiceSchema).length(2, "OX 문항은 보기가 정확히 2개여야 합니다.").refine(exactlyOneCorrect, {
    message: "정답은 정확히 1개여야 합니다.",
  }),
});

const shortAnswerSchema = z.object({
  type: z.literal("SHORT_ANSWER"),
  ...baseFields,
  acceptedAnswers: z.array(z.string().trim().min(1).max(200)).min(1).max(10),
});

// type을 생략하면 기존 호출과 하위 호환을 위해 SINGLE_CHOICE로 취급합니다.
const createSchema = z.preprocess(
  (value) => (value && typeof value === "object" && !("type" in value) ? { ...value, type: "SINGLE_CHOICE" } : value),
  z.discriminatedUnion("type", [singleChoiceSchema, trueFalseSchema, shortAnswerSchema]),
);

export async function POST(request: Request, { params }: { params: Promise<{ quizId: string }> }) {
  try {
    assertSameOrigin(request);
    const actor = await requireActiveUser();
    const { quizId } = await params;
    await requireManageableQuiz(quizId, actor);

    const body = createSchema.parse(await request.json());
    const question = await withQuizImageLock(quizId, async () => {
      await assertQuizImageReferences(quizId, { questionUrls: [body.imageUrl] });
      const prisma = getPrisma();
      const lastQuestion = await prisma.question.findFirst({
        where: { quizId },
        orderBy: { position: "desc" },
        select: { position: true },
      });
      const position = (lastQuestion?.position ?? -1) + 1;

      return prisma.question.create({
        data: {
          quizId,
          type: body.type,
          text: body.text,
          imageUrl: body.imageUrl,
          timeLimitSec: body.timeLimitSec ?? 20,
          points: body.points ?? 1000,
          position,
          acceptedAnswers: body.type === "SHORT_ANSWER" ? body.acceptedAnswers : [],
          ...(body.type !== "SHORT_ANSWER"
            ? { choices: { create: body.choices.map((choice, index) => ({ text: choice.text, isCorrect: choice.isCorrect, position: index })) } }
            : {}),
        },
        include: { choices: { orderBy: { position: "asc" } } },
      });
    });

    return Response.json({ question }, { status: 201 });
  } catch (error) {
    return apiError(error, "문항을 추가하지 못했습니다.");
  }
}
