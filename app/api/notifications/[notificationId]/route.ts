import { requireActiveUser } from "@/lib/auth/authorization";
import { apiError, assertSameOrigin } from "@/lib/http";
import { getPrisma } from "@/lib/prisma";

export async function PATCH(request: Request, { params }: { params: Promise<{ notificationId: string }> }) {
  try {
    assertSameOrigin(request);
    const user = await requireActiveUser();
    const { notificationId } = await params;
    const result = await getPrisma().notification.updateMany({
      where: { id: notificationId, userId: user.id },
      data: { readAt: new Date() },
    });
    if (result.count === 0) return Response.json({ error: "알림을 찾을 수 없습니다." }, { status: 404 });
    return Response.json({ ok: true });
  } catch (error) {
    return apiError(error, "알림을 처리하지 못했습니다.");
  }
}
