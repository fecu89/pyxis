import { z } from "zod";
import { requireActiveUser } from "@/lib/auth/authorization";
import { requireOwnedForm } from "@/lib/forms/access";
import { listFormShares, ShareTargetError, upsertFormShare } from "@/lib/forms/shares";
import { apiError, assertSameOrigin } from "@/lib/http";

// 설문 공유 목록·부여. `app/api/quiz/quizzes/[quizId]/shares/route.ts`와 같은 자리입니다.
// 공유 관리는 소유자만 — 공유받은 EDITOR도 다른 사람에게 다시 공유할 수는 없습니다.
//
// GET·POST 모두 `lib/forms/shares.ts`를 그대로 씁니다. 후보 범위(같은 학교, VIEW_USERS면
// 전체)와 대상 검증은 `lib/users/share-scope.ts`의 `teacherShareCandidateScope` 하나로
// 판정합니다 — 퀴즈 공유 라우트와 같은 함수입니다.

const shareSchema = z.object({
  userId: z.string().min(1),
  permission: z.enum(["EDITOR", "VIEWER"]),
});

export async function GET(_request: Request, { params }: { params: Promise<{ formId: string }> }) {
  try {
    const actor = await requireActiveUser();
    const { formId } = await params;
    const form = await requireOwnedForm(formId, actor);
    return Response.json(await listFormShares(formId, form.ownerId, actor));
  } catch (error) {
    return apiError(error, "공유 정보를 불러오지 못했습니다.");
  }
}

export async function POST(request: Request, { params }: { params: Promise<{ formId: string }> }) {
  try {
    assertSameOrigin(request);
    const actor = await requireActiveUser();
    const { formId } = await params;
    const form = await requireOwnedForm(formId, actor);
    const body = shareSchema.parse(await request.json());
    await upsertFormShare(formId, form.ownerId, actor, body.userId, body.permission);
    return Response.json({ ok: true });
  } catch (error) {
    if (error instanceof ShareTargetError) return Response.json({ error: error.message }, { status: 400 });
    return apiError(error, "설문을 공유하지 못했습니다.");
  }
}
