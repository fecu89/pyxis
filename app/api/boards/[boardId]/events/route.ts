import { canModeratePosts, canReadEffectiveBoard, getEffectiveBoardAccess } from "@/lib/auth/authorization";
import { getCurrentUser } from "@/lib/auth/current-user";
import { readGuestSession } from "@/lib/board/guest-session";
import { subscribeBoardEvent, type BoardEvent } from "@/lib/realtime/board-events";
import { markViewing } from "@/lib/realtime/board-viewers";
import { createEventStream } from "@/lib/realtime/sse-stream";
import { trustedClientIdentifier } from "@/lib/security/client-ip";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// 한 사람이 같은 보드를 여러 탭으로 열 수는 있어야 하지만(수업 중 흔함), 스크립트가 무한정
// 붙는 건 막아야 합니다. 비로그인 방문자는 신뢰 가능한 IP가 없으면 하나의 버킷으로 묶이므로
// 공개 보드의 정상 열람이 서로를 막지 않도록 조금 더 여유를 둡니다.
const MAX_CONNECTIONS_PER_VIEWER = 6;
// 학교 NAT 한 곳에서 QR로 들어온 100명 이상이 같은 공인 IP를 쓰는 경우를 허용합니다. 익명
// 버킷을 무제한으로 열지는 않고, 프로세스 전체 상한(MAX_SSE_CONNECTIONS)이 마지막 방어선입니다.
const MAX_CONNECTIONS_PER_ANONYMOUS_BUCKET = 240;

export async function GET(request: Request, { params }: { params: Promise<{ boardId: string }> }) {
  const { boardId } = await params;
  const currentUser = await getCurrentUser();
  const access = await getEffectiveBoardAccess(boardId, currentUser);
  if (!access || !canReadEffectiveBoard(currentUser, access)) {
    return Response.json({ error: "패드 접근 권한이 없습니다." }, { status: 403 });
  }
  const guest = currentUser ? null : await readGuestSession(boardId);
  const canModerate = Boolean(currentUser && canModeratePosts(currentUser, access));

  return createEventStream({
    request,
    connectionKey: currentUser
      ? `board:${boardId}|u:${currentUser.id}`
      : `board:${boardId}|ip:${trustedClientIdentifier(request.headers)}`,
    maxPerKey: currentUser ? MAX_CONNECTIONS_PER_VIEWER : MAX_CONNECTIONS_PER_ANONYMOUS_BUCKET,
    subscribe(emit, close) {
      // 아래 구독 등록까지 동기적으로 이어지므로 클라이언트가 ready를 처리하기 전에 완료됩니다.
      // ready 쓰기 자체가 실패하면 리스너를 등록하지 않아 스트림 시작 중 해제 누수도 피합니다.
      if (!emit("ready", { boardId })) return;
      const unsubscribe = subscribeBoardEvent(boardId, (event: BoardEvent) => {
        const delivery = event.delivery;
        const isAuthor = Boolean(delivery && (
          (currentUser && delivery.authorUserId === currentUser.id)
          || (guest && delivery.authorGuestId === guest.guestId)
        ));
        const isRecipient = Boolean(delivery && (
          (currentUser && delivery.recipientUserIds?.includes(currentUser.id))
          || (guest && delivery.recipientGuestIds?.includes(guest.guestId))
        ));
        if (delivery && !delivery.public && !isAuthor && !isRecipient && !canModerate) return;

        // 내부 authorGuestId를 절대 wire에 싣지 않습니다. 게시물 스냅샷의 viewer 전용 값은
        // 연결별로 계산해 같은 공용 이벤트가 다른 사용자에게 수정 권한을 잘못 열지 않게 합니다.
        const { delivery: _delivery, ...wireEvent } = event;
        void _delivery;
        const basePayload = wireEvent.payload && wireEvent.payload.actorReactions && currentUser?.id !== event.actorId
          ? (({ actorReactions, ...rest }) => { void actorReactions; return rest; })(wireEvent.payload)
          : wireEvent.payload;
        const payload = basePayload
          ? {
              ...basePayload,
              ...(basePayload.post
                ? { post: { ...basePayload.post, isMine: isAuthor } }
                : {}),
              ...(basePayload.comment
                ? { comment: { ...basePayload.comment, isMine: isAuthor } }
                : {}),
            }
          : undefined;
        emit("board-change", { ...wireEvent, payload });

        // 공개→비공개, 멤버 제거처럼 접근 결과가 바뀔 수 있는 이벤트 뒤에는 현재 연결을
        // 종료합니다. 브라우저의 다음 연결은 GET 진입부에서 권한을 다시 판정하므로, 이미
        // 접속해 있던 클라이언트가 이후 이벤트를 계속 받는 권한 누수를 막습니다. 이벤트를 먼저
        // 보내 정상 클라이언트는 전용 스냅샷으로 화면도 수렴시킵니다.
        if (event.payload?.requiresSync || (event.type === "board.updated" && !event.payload?.boardPatch)) {
          close();
        }
      });
      const stopViewing = currentUser ? markViewing(boardId, currentUser.id) : undefined;
      return () => {
        unsubscribe();
        stopViewing?.();
      };
    },
  });
}
