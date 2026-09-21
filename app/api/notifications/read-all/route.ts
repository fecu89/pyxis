import { requireActiveUser } from "@/lib/auth/authorization";
import { apiError, assertSameOrigin } from "@/lib/http";
import { getPrisma } from "@/lib/prisma";

export async function POST(request: Request) {
  try {
    assertSameOrigin(request);
    const user = await requireActiveUser();
    await getPrisma().notification.updateMany({ where: { userId: user.id, readAt: null }, data: { readAt: new Date() } });
    return Response.json({ ok: true });
  } catch (error) {
    return apiError(error, "알림을 처리하지 못했습니다.");
  }
}
