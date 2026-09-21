import { Prisma } from "@/generated/prisma/client";
import { requireActiveUser } from "@/lib/auth/authorization";
import { apiError, assertSameOrigin } from "@/lib/http";
import { getPrisma } from "@/lib/prisma";
import { requireViewableQuiz } from "@/lib/quiz/access";
import { requireQuizCreationCapacity } from "@/lib/quiz/creation-limit";
import { copyQuizImages, parseQuizImageUrl, removeQuizImages } from "@/lib/quiz/image-store";
import { normalizeSubjectName } from "@/lib/quiz/subjects";

export async function POST(request: Request, { params }: { params: Promise<{ quizId: string }> }) {
  try {
    assertSameOrigin(request);
    const actor = await requireActiveUser();
    await requireQuizCreationCapacity(actor);
    const { quizId } = await params;
    await requireViewableQuiz(quizId, actor);
    const source = await getPrisma().quiz.findUniqueOrThrow({
      where: { id: quizId },
      include: {
        subject: { select: { name: true } },
        questions: { orderBy: { position: "asc" }, include: { choices: { orderBy: { position: "asc" } } } },
      },
    });

    // 이미지는 퀴즈 디렉터리에 파일로 있으므로 주소만 베끼면 사본이 원본의 파일을 가리킵니다.
    // 그러면 원본을 지우는 순간 사본의 사진까지 사라집니다. 복제는 "가져다 내 것으로 고치는"
    // 기능이라 원본 수명에 묶이면 안 되므로 파일을 복사하고 주소를 새로 매깁니다.
    //
    // 그래서 한 번의 create로 끝내지 않고 껍데기를 먼저 만듭니다 — 복사할 대상 디렉터리 이름이
    // 곧 새 퀴즈 ID라 그전에는 알 수 없습니다.
    const shell = await getPrisma().quiz.create({
      data: {
        owner: { connect: { id: actor.id } },
        title: `${source.title} 복사본`.slice(0, 120),
        description: source.description,
        thumbnailAlt: source.thumbnailAlt,
        requiresLogin: source.requiresLogin,
        answerPalette: source.answerPalette,
        ...(source.subject ? {
          subject: {
            connectOrCreate: {
              where: { ownerId_nameNormalized: { ownerId: actor.id, nameNormalized: normalizeSubjectName(source.subject.name) } },
              create: { ownerId: actor.id, name: source.subject.name, nameNormalized: normalizeSubjectName(source.subject.name) },
            },
          },
        } : {}),
      },
      select: { id: true },
    });

    try {
      const imageMap = await copyQuizImages(source.id, shell.id, [source.thumbnailUrl, ...source.questions.map((question) => question.imageUrl)]);
      // 외부 http(s) 주소는 그대로 두되, 내부 파일은 소스 퀴즈에 속하고 복사까지 성공한 경우만
      // 새 주소를 씁니다. 누락·교차 참조 파일을 원본 주소로 되돌리면 복제본이 다시 원본 수명과
      // 권한에 묶입니다.
      const remap = (url: string | null) => {
        if (!url) return null;
        const stored = parseQuizImageUrl(url);
        if (!stored) return url;
        if (stored.quizId !== source.id) return null;
        return imageMap.get(url) ?? null;
      };

      const copy = await getPrisma().quiz.update({
        where: { id: shell.id },
        data: {
          thumbnailUrl: remap(source.thumbnailUrl),
          questions: {
            create: source.questions.map((question) => ({
              type: question.type,
              text: question.text,
              imageUrl: remap(question.imageUrl),
              imageAlt: question.imageAlt,
              imagePlaceholder: question.imagePlaceholder,
              timeLimitSec: question.timeLimitSec,
              points: question.points,
              position: question.position,
              multipleSelection: question.multipleSelection,
              acceptedAnswers: question.acceptedAnswers,
              orderedItems: question.orderedItems,
              numericMin: question.numericMin,
              numericMax: question.numericMax,
              numericAnswer: question.numericAnswer,
              slideLayout: question.slideLayout,
              slideBody: question.slideBody,
              // 유형 전용 값도 함께 복사해야 복제본이 원본과 같은 문항이 됩니다.
              pinAreas: question.pinAreas === null ? Prisma.DbNull : (question.pinAreas as Prisma.InputJsonValue),
              likertSteps: question.likertSteps,
              likertMinLabel: question.likertMinLabel,
              likertMaxLabel: question.likertMaxLabel,
              revealResponsesLive: question.revealResponsesLive,
              choices: {
                create: question.choices.map((choice) => ({ text: choice.text, isCorrect: choice.isCorrect, position: choice.position })),
              },
            })),
          },
        },
        select: { id: true, title: true },
      });
      return Response.json({ quiz: copy }, { status: 201 });
    } catch (error) {
      await Promise.allSettled([
        getPrisma().quiz.delete({ where: { id: shell.id } }),
        removeQuizImages(shell.id),
      ]);
      throw error;
    }
  } catch (error) {
    return apiError(error, "퀴즈를 복제하지 못했습니다.");
  }
}
