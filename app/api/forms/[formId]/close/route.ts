import { syncActivity } from "@/lib/activity/ensure";
import { requireActiveUser } from "@/lib/auth/authorization";
import { requireManageableForm } from "@/lib/forms/access";
import { apiError, assertSameOrigin } from "@/lib/http";
import { getPrisma } from "@/lib/prisma";

// 마감: OPEN → CLOSED. 링크는 살아 있지만 "마감된 설문입니다" 안내만 뜹니다.
//
// 링크를 죽이지 않는 이유 — 마감 뒤에 링크를 누른 사람이 404를 보면 주소를 잘못 받았다고
// 생각하고 다시 물어봅니다. 마감됐다는 사실 자체가 알려 줘야 하는 정보입니다.

export async function POST(request: Request, { params }: { params: Promise<{ formId: string }> }) {
  try {
    assertSameOrigin(request);
    const actor = await requireActiveUser();
    const { formId } = await params;
    const form = await requireManageableForm(formId, actor);
    if (form.status !== "OPEN") {
      return Response.json({ error: form.status === "CLOSED" ? "이미 마감된 설문입니다." : "발행한 설문만 마감할 수 있습니다." }, { status: 409 });
    }

    const now = new Date();
    const updated = await getPrisma().$transaction(async (tx) => {
      const next = await tx.form.update({
        where: { id: formId },
        data: { status: "CLOSED" },
        // 마감도 Form.updatedAt을 바꾸므로 열린 편집기가 다음 저장에 쓸 버전을 함께 받습니다.
        select: { id: true, status: true, slug: true, title: true, updatedAt: true },
      });
      await syncActivity(tx, form.activityId, { endedAt: now });
      return next;
    });

    return Response.json({ form: updated });
  } catch (error) {
    return apiError(error, "설문을 마감하지 못했습니다.");
  }
}
