import { requireActiveUser } from "@/lib/auth/authorization";
import { requireOwnedForm } from "@/lib/forms/access";
import { removeFormShare } from "@/lib/forms/shares";
import { apiError, assertSameOrigin } from "@/lib/http";

export async function DELETE(request: Request, { params }: { params: Promise<{ formId: string; userId: string }> }) {
  try {
    assertSameOrigin(request);
    const actor = await requireActiveUser();
    const { formId, userId } = await params;
    await requireOwnedForm(formId, actor);
    await removeFormShare(formId, userId);
    return Response.json({ ok: true });
  } catch (error) {
    return apiError(error, "공유 권한을 제거하지 못했습니다.");
  }
}
