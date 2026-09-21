// 검증 스크립트들이 공유하는 fixture 헬퍼.
//
// `Board.activityId`·`Form.activityId`가 필수라(prisma/schema/activity.prisma) 임시 보드나
// 설문을 만들 때마다 활동 레코드가 함께 있어야 합니다. 각 스크립트가 이걸 따로 쓰면 fixture
// 정리에서 빠뜨리기 쉬워 여기 모읍니다.

type FixtureActivityType = "PAD_BOARD" | "QUIZ_SESSION" | "FORM";

type ActivityCreator = {
  activity: { create: (args: { data: { type: FixtureActivityType; ownerId: string; title: string }; select: { id: true } }) => Promise<{ id: string }> };
};

/** 임시 패드 보드용 활동을 만들고 id를 돌려줍니다. 보드를 지우면 이 활동도 함께 지우세요. */
export async function createPadActivity(prisma: ActivityCreator, ownerId: string, title: string) {
  const activity = await prisma.activity.create({
    data: { type: "PAD_BOARD", ownerId, title },
    select: { id: true },
  });
  return activity.id;
}

/** 임시 설문용 활동. 정리는 `deleteFormFixture`로 하세요(활동만 지우면 안 됩니다). */
export async function createFormActivity(prisma: ActivityCreator, ownerId: string, title: string) {
  const activity = await prisma.activity.create({
    data: { type: "FORM", ownerId, title },
    select: { id: true },
  });
  return activity.id;
}

type FormCleaner = {
  formAnswer: { deleteMany: (args: { where: { field: { formId: string } } }) => Promise<unknown> };
  activity: { delete: (args: { where: { id: string } }) => Promise<unknown> };
};

/**
 * 설문 fixture를 지웁니다. **답변을 먼저 지워야 합니다.**
 *
 * `FormAnswer.fieldId`가 RESTRICT라(응답이 달린 질문을 실수로 못 지우게 하려는 것) 활동만
 * 지우면 Activity → Form → FormField cascade가 그 제약에 걸려 통째로 실패합니다. 응답 쪽
 * cascade(FormResponse → FormAnswer)가 먼저 끝난다는 보장이 없어서, 순서를 여기서 못 박습니다.
 * 운영 코드의 영구 삭제 경로도 같은 순서를 따라야 합니다.
 */
export async function deleteFormFixture(prisma: FormCleaner, formId: string, activityId: string) {
  await prisma.formAnswer.deleteMany({ where: { field: { formId } } });
  await prisma.activity.delete({ where: { id: activityId } });
}
