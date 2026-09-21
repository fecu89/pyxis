import { requireActiveUser } from "@/lib/auth/authorization";
import { apiError } from "@/lib/http";
import { getNotificationList, getNotificationSummary } from "@/lib/notifications/list";

export async function GET(request: Request) {
  try {
    const user = await requireActiveUser();
    const params = new URL(request.url).searchParams;
    const requested = Number(params.get("limit") ?? "20");
    const data = params.get("summary") === "1"
      ? await getNotificationSummary(user.id)
      : await getNotificationList(user.id, requested);
    return Response.json(data, {
      headers: { "Cache-Control": "private, no-store" },
    });
  } catch (error) {
    return apiError(error, "알림을 불러오지 못했습니다.");
  }
}
