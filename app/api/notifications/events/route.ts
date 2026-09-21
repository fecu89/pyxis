import { requireActiveUser } from "@/lib/auth/authorization";
import { subscribeUserEvent, type UserEvent } from "@/lib/realtime/user-events";
import { createEventStream } from "@/lib/realtime/sse-stream";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// 알림 벨은 대시보드 셸과 패드 상단 양쪽에 있어 한 사람이 여러 탭을 열 수 있습니다.
const MAX_CONNECTIONS_PER_USER = 6;

export async function GET(request: Request) {
  let user;
  try {
    user = await requireActiveUser();
  } catch {
    return Response.json({ error: "로그인이 필요합니다." }, { status: 401 });
  }

  const userId = user.id;
  return createEventStream({
    request,
    connectionKey: `notifications|u:${userId}`,
    maxPerKey: MAX_CONNECTIONS_PER_USER,
    subscribe(emit) {
      emit("ready", { userId });
      return subscribeUserEvent(userId, (event: UserEvent) => emit("notification", event));
    },
  });
}
