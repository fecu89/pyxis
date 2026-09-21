import "server-only";

import { getPrisma } from "@/lib/prisma";
import type { QuizAccessLevel } from "@/lib/quiz/access";

export async function loadQuizEditorData(quizId: string, ownerId: string, accessLevel: QuizAccessLevel) {
  const [quiz, availableSubjects] = await Promise.all([
    getPrisma().quiz.findUnique({
      where: { id: quizId },
      include: {
        subject: { select: { id: true, name: true } },
        questions: {
          orderBy: { position: "asc" },
          include: { choices: { orderBy: { position: "asc" } } },
        },
      },
    }),
    accessLevel === "VIEWER"
      ? Promise.resolve([])
      : getPrisma().subject.findMany({
          where: { ownerId },
          orderBy: { name: "asc" },
          select: { id: true, name: true },
        }),
  ]);
  return quiz ? { ...quiz, accessLevel, availableSubjects } : null;
}
