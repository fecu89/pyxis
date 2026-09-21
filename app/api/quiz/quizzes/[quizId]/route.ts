import { Prisma } from "@/generated/prisma/client";
import { z } from "zod";
import { hasSystemPermission, requireActiveUser } from "@/lib/auth/authorization";
import { requireManageableQuiz, requireOwnedQuiz, requireViewableQuiz } from "@/lib/quiz/access";
import { apiError, assertSameOrigin } from "@/lib/http";
import { readJsonWithLimit } from "@/lib/http-json";
import { getPrisma } from "@/lib/prisma";
import { bulkUpdateChoices, type ChoiceBulkUpdate } from "@/lib/quiz/choice-bulk-update";
import { assertQuizImageReferences, pruneUnreferencedQuizImages, withQuizImageLock } from "@/lib/quiz/image-store";
import { editorSaveSchema } from "@/lib/quiz/question-schema";
import { cleanSubjectName, normalizeSubjectName } from "@/lib/quiz/subjects";
import { loadQuizEditorData } from "@/lib/quiz/editor-data";

const QUIZ_PATCH_BODY_MAX_BYTES = 32 * 1024;
const QUIZ_DOCUMENT_BODY_MAX_BYTES = 2 * 1024 * 1024;

export async function GET(_request: Request, { params }: { params: Promise<{ quizId: string }> }) {
  try {
    const actor = await requireActiveUser();
    const { quizId } = await params;
    const access = await requireViewableQuiz(quizId, actor);
    const accessLevel = access.level === "OWNER" ? "OWNER" : access.level === "EDITOR" ? "EDITOR" : "VIEWER";
    const quiz = await loadQuizEditorData(quizId, access.quiz.ownerId, accessLevel);
    return Response.json({ quiz });
  } catch (error) {
    return apiError(error, "퀴즈를 불러오지 못했습니다.");
  }
}

const patchSchema = z.object({
  title: z.string().trim().min(1).max(120).optional(),
  description: z.string().trim().max(2000).nullable().optional(),
  requiresLogin: z.boolean().optional(),
  answerPalette: z.enum(["BRAND", "SOFT", "FOREST"]).optional(),
  subjectName: z.string().trim().max(60).nullable().optional(),
});

export async function PATCH(request: Request, { params }: { params: Promise<{ quizId: string }> }) {
  try {
    assertSameOrigin(request);
    const actor = await requireActiveUser();
    const { quizId } = await params;
    const existing = await requireManageableQuiz(quizId, actor);

    const data = patchSchema.parse(await readJsonWithLimit(request, QUIZ_PATCH_BODY_MAX_BYTES));
    const { subjectName, ...quizData } = data;
    let subjectId: string | null | undefined;
    if (subjectName !== undefined) {
      const name = cleanSubjectName(subjectName);
      subjectId = name
        ? (await getPrisma().subject.upsert({
            where: { ownerId_nameNormalized: { ownerId: existing.ownerId, nameNormalized: normalizeSubjectName(name) } },
            create: { ownerId: existing.ownerId, name, nameNormalized: normalizeSubjectName(name) },
            update: { name },
            select: { id: true },
          })).id
        : null;
    }
    const quiz = await getPrisma().quiz.update({ where: { id: quizId }, data: { ...quizData, ...(subjectId !== undefined ? { subjectId } : {}) } });
    return Response.json({ quiz });
  } catch (error) {
    return apiError(error, "퀴즈를 수정하지 못했습니다.");
  }
}

export async function PUT(request: Request, { params }: { params: Promise<{ quizId: string }> }) {
  try {
    assertSameOrigin(request);
    const actor = await requireActiveUser();
    const { quizId } = await params;
    const existingQuiz = await requireManageableQuiz(quizId, actor);
    const body = editorSaveSchema.parse(await readJsonWithLimit(request, QUIZ_DOCUMENT_BODY_MAX_BYTES));
    const prisma = getPrisma();

    const quiz = await withQuizImageLock(quizId, async () => {
      await assertQuizImageReferences(quizId, {
        thumbnailUrl: body.thumbnailUrl,
        questionUrls: body.questions.map((question) => question.imageUrl),
      });

      await prisma.$transaction(async (tx) => {
        // 진행 중(대기실 포함) 세션이 있는 동안 문항을 바꾸면 참가자 화면의 문항 번호가 어긋나므로
        // 저장을 통째로 막습니다. 끝난 세션은 편집을 막지 않습니다 — 지난 결과가 있다는 이유로
        // 퀴즈를 고칠 수 없게 되면 재사용이 불가능해집니다.
        const activeSession = await tx.quizSession.findFirst({
          where: { quizId, status: { in: ["LOBBY", "IN_PROGRESS"] } },
          select: { id: true },
        });
        if (activeSession) {
          throw new Error("진행 중인 세션이 있어 저장할 수 없습니다. 세션을 마치거나 취소한 뒤 다시 저장해 주세요.");
        }
        const subjectName = cleanSubjectName(body.subjectName);
        const subjectId = subjectName
          ? (await tx.subject.upsert({
              where: { ownerId_nameNormalized: { ownerId: existingQuiz.ownerId, nameNormalized: normalizeSubjectName(subjectName) } },
              create: { ownerId: existingQuiz.ownerId, name: subjectName, nameNormalized: normalizeSubjectName(subjectName) },
              update: { name: subjectName },
              select: { id: true },
            })).id
          : null;
        const existingQuestions = await tx.question.findMany({
          where: { quizId },
          include: { choices: { orderBy: { position: "asc" } } },
        });
        const existingById = new Map(existingQuestions.map((question) => [question.id, question]));
        const requestedIds = body.questions.flatMap((question) => (question.id ? [question.id] : []));
        if (new Set(requestedIds).size !== requestedIds.length || requestedIds.some((id) => !existingById.has(id))) {
          throw new Error("저장할 문항 목록이 현재 퀴즈와 일치하지 않습니다. 새로고침 후 다시 시도해 주세요.");
        }

        const requestedIdSet = new Set(requestedIds);
        const removed = existingQuestions.filter((question) => !requestedIdSet.has(question.id));
        if (removed.length) {
          // 응답 기록이 있어도 삭제를 막지 않습니다(진행 중 세션은 위에서 이미 걸렀습니다).
          // Answer→Question FK가 RESTRICT라 문항을 지우기 전에 그 문항의 답안 기록을 먼저 지웁니다.
          // 참가자 점수·순위는 세션에 저장된 값이라 그대로 남고, 결과 리포트에서 이 문항만 빠집니다.
          const removedIds = removed.map((question) => question.id);
          await tx.answer.deleteMany({ where: { questionId: { in: removedIds } } });
          await tx.question.deleteMany({ where: { id: { in: removedIds } } });
        }

        const choicesToUpdate: ChoiceBulkUpdate[] = [];
        const choicesToCreate: Array<{ questionId: string; text: string; isCorrect: boolean; position: number }> = [];
        const choiceIdsToRemove: string[] = [];

        for (const [position, question] of body.questions.entries()) {
          const choiceInput = question.type === "SINGLE_CHOICE" || question.type === "TRUE_FALSE" || question.type === "SURVEY"
            ? question.choices.map((choice, index) => ({
                id: choice.id,
                text: choice.text,
                isCorrect: question.type === "SURVEY" ? false : choice.isCorrect,
                position: index,
              }))
            : [];
          const questionData = {
            type: question.type,
            text: question.text,
            imageUrl: question.imageUrl ?? null,
            imageAlt: question.imageAlt?.trim() || null,
            imagePlaceholder: question.imagePlaceholder?.trim() || null,
            timeLimitSec: question.timeLimitSec,
            points: question.points,
            position,
            multipleSelection: question.type === "SINGLE_CHOICE" ? question.multipleSelection : false,
            acceptedAnswers: question.type === "SHORT_ANSWER" ? question.acceptedAnswers : [],
            orderedItems: question.type === "ORDERING" ? question.orderedItems : [],
            numericMin: question.type === "NUMERIC" ? question.numericMin : null,
            numericMax: question.type === "NUMERIC" ? question.numericMax : null,
            numericAnswer: question.type === "NUMERIC" ? question.numericAnswer : null,
            slideLayout: question.type === "SLIDE" ? question.slideLayout : null,
            slideBody: question.type === "SLIDE" ? question.slideBody.trim() || null : null,
            // 유형 전용 값은 그 유형일 때만 저장하고 나머지는 비웁니다 — 유형을 바꾼 뒤에도 옛 값이
            // 남아 있으면 채점·화면이 지금 유형과 어긋난 데이터를 보게 됩니다.
            pinAreas: question.type === "PIN_ANCHOR" ? (question.pinAreas as Prisma.InputJsonValue) : Prisma.DbNull,
            likertSteps: question.type === "LIKERT" ? question.likertSteps : null,
            likertMinLabel: question.type === "LIKERT" ? question.likertMinLabel.trim() : null,
            likertMaxLabel: question.type === "LIKERT" ? question.likertMaxLabel.trim() : null,
            // 참여형에만 있는 값입니다. 채점형은 공개 전 분포가 정답 힌트가 되므로 항상 false로 둡니다.
            revealResponsesLive: "revealResponsesLive" in question ? question.revealResponsesLive : false,
          };

          if (!question.id) {
            await tx.question.create({
              data: {
                quizId,
                ...questionData,
                ...(choiceInput.length ? { choices: { create: choiceInput.map(({ text, isCorrect, position: choicePosition }) => ({ text, isCorrect, position: choicePosition })) } } : {}),
              },
            });
            continue;
          }

          const existing = existingById.get(question.id);
          if (!existing) throw new Error("저장할 문항을 찾을 수 없습니다.");
          const existingChoiceById = new Map(existing.choices.map((choice) => [choice.id, choice]));
          const requestedChoiceIds = choiceInput.flatMap((choice) => choice.id ? [choice.id] : []);
          if (new Set(requestedChoiceIds).size !== requestedChoiceIds.length || requestedChoiceIds.some((id) => !existingChoiceById.has(id))) {
            throw new Error("저장할 보기 목록이 현재 문항과 일치하지 않습니다. 새로고침 후 다시 시도해 주세요.");
          }
          const choicesChanged = existing.choices.length !== choiceInput.length || existing.choices.some((choice, index) => {
            const next = choiceInput[index];
            return !next || choice.id !== next.id || choice.text !== next.text || choice.isCorrect !== next.isCorrect || choice.position !== next.position;
          });
          if (choicesChanged) {
            const retainedIds = new Set(requestedChoiceIds);
            choiceIdsToRemove.push(...existing.choices.filter((choice) => !retainedIds.has(choice.id)).map((choice) => choice.id));

            for (const choice of choiceInput) {
              if (choice.id) {
                choicesToUpdate.push({ id: choice.id, text: choice.text, isCorrect: choice.isCorrect, position: choice.position });
              } else {
                choicesToCreate.push({ questionId: question.id, text: choice.text, isCorrect: choice.isCorrect, position: choice.position });
              }
            }
          }
          await tx.question.update({ where: { id: question.id }, data: questionData });
        }

        if (choiceIdsToRemove.length) {
          await tx.answer.updateMany({ where: { choiceId: { in: choiceIdsToRemove } }, data: { choiceId: null } });
          await tx.choice.deleteMany({ where: { id: { in: choiceIdsToRemove } } });
        }
        await bulkUpdateChoices(tx, choicesToUpdate);
        if (choicesToCreate.length) await tx.choice.createMany({ data: choicesToCreate });

        await tx.quiz.update({
          where: { id: quizId },
          data: {
            title: body.title,
            description: body.description,
            thumbnailUrl: body.thumbnailUrl ?? null,
            thumbnailAlt: body.thumbnailAlt?.trim() || null,
            requiresLogin: body.requiresLogin,
            isSearchable: body.isSearchable,
            answerPalette: body.answerPalette,
            subjectId,
            isPublished: false,
          },
        });
      });

      // 같은 퀴즈의 저장을 파일 잠금 안에서 직렬화합니다. 트랜잭션이 끝난 뒤 DB를 다시 읽은 최신
      // 참조만 기준으로 정리하므로, 먼저 끝난 요청의 오래된 응답이 나중 저장의 파일을 지우지 않습니다.
      const latest = await prisma.quiz.findUniqueOrThrow({
        where: { id: quizId },
        include: { subject: { select: { id: true, name: true } }, questions: { orderBy: { position: "asc" }, include: { choices: { orderBy: { position: "asc" } } } } },
      });
      await pruneUnreferencedQuizImages(quizId, [latest.thumbnailUrl, ...latest.questions.map((question) => question.imageUrl)])
        .catch((error) => console.warn(`[퀴즈 이미지 정리 실패] quiz:${quizId} 사유=${error instanceof Error ? error.message : "알 수 없음"}`));
      return latest;
    });

    const availableSubjects = await getPrisma().subject.findMany({ where: { ownerId: existingQuiz.ownerId }, orderBy: { name: "asc" }, select: { id: true, name: true } });
    return Response.json({ quiz: { ...quiz, availableSubjects, accessLevel: existingQuiz.ownerId === actor.id || hasSystemPermission(actor, "EDIT_ANY_QUIZ") ? "OWNER" : "EDITOR" } });
  } catch (error) {
    return apiError(error, "퀴즈 편집 내용을 저장하지 못했습니다.");
  }
}

export async function DELETE(_request: Request, { params }: { params: Promise<{ quizId: string }> }) {
  try {
    assertSameOrigin(_request);
    const actor = await requireActiveUser();
    const { quizId } = await params;
    await requireOwnedQuiz(quizId, actor);

    // 소프트 삭제라 Notification의 onDelete: Cascade가 발동하지 않습니다. 패드와 달리 퀴즈는
    // 복원 경로가 없어(deletedAt을 되돌리는 코드가 없습니다) 알림을 남겨 둘 이유가 없고,
    // 남겨 두면 제목 없는 "누군가님이 퀴즈를 공유했어요"가 눌러도 아무 데도 못 가는 채로
    // 벨에 쌓입니다. 삭제와 같은 트랜잭션에서 정리합니다.
    //
    // QUIZ_ASSIGNED·QUIZ_SHARED 모두 quizId를 채우므로 이 한 조건으로 둘 다 걸립니다
    // (assignmentId만 있는 알림은 만들어지지 않습니다).
    await getPrisma().$transaction(async (transaction) => {
      await transaction.quiz.update({ where: { id: quizId }, data: { deletedAt: new Date() } });
      await transaction.notification.deleteMany({ where: { quizId } });
    });
    return Response.json({ ok: true });
  } catch (error) {
    return apiError(error, "퀴즈를 삭제하지 못했습니다.");
  }
}
