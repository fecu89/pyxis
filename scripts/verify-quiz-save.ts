import "../lib/load-env";
import assert from "node:assert/strict";
import { getPrisma } from "../lib/prisma";
import { bulkUpdateChoices } from "../lib/quiz/choice-bulk-update";

async function main() {
  const prisma = getPrisma();
  const owner = await prisma.user.findFirst({ where: { status: "ACTIVE" }, select: { id: true } });
  if (!owner) throw new Error("검증에 사용할 활성 사용자가 없습니다.");

  const quiz = await prisma.quiz.create({
    data: {
      ownerId: owner.id,
      title: "퀴즈 저장 일괄 갱신 검증",
      questions: {
        create: {
          type: "SINGLE_CHOICE",
          text: "검증 문항",
          position: 0,
          choices: {
            create: [
              { text: "이전 A", isCorrect: true, position: 0 },
              { text: "이전 B", isCorrect: false, position: 1 },
            ],
          },
        },
      },
    },
    select: { id: true, questions: { select: { choices: { orderBy: { position: "asc" } } } } },
  });

  try {
    const [first, second] = quiz.questions[0]!.choices;
    const updated = await prisma.$transaction((tx) => bulkUpdateChoices(tx, [
      { id: first.id, text: "새 B", isCorrect: false, position: 1 },
      { id: second.id, text: "새 A", isCorrect: true, position: 0 },
    ]));
    assert.equal(updated, 2, "보기 2건이 한 번에 갱신되어야 합니다.");

    const choices = await prisma.choice.findMany({ where: { questionId: first.questionId }, orderBy: { position: "asc" } });
    assert.deepEqual(
      choices.map((choice) => ({ id: choice.id, text: choice.text, isCorrect: choice.isCorrect, position: choice.position })),
      [
        { id: second.id, text: "새 A", isCorrect: true, position: 0 },
        { id: first.id, text: "새 B", isCorrect: false, position: 1 },
      ],
      "일괄 갱신이 보기 ID를 보존하면서 값과 순서를 바꿔야 합니다.",
    );

    const missingSnapshots = await prisma.answer.count({
      where: {
        selectedChoiceTexts: { isEmpty: true },
        OR: [{ choiceId: { not: null } }, { selectedChoiceIds: { isEmpty: false } }],
      },
    });
    assert.equal(missingSnapshots, 0, "보기 답안 스냅샷이 누락된 기존 행이 있습니다.");
    console.log("quiz_save_checks=passed");
  } finally {
    await prisma.quiz.delete({ where: { id: quiz.id } });
    await prisma.$disconnect();
  }
}

void main().catch((error) => {
  console.error(error);
  process.exit(1);
});
