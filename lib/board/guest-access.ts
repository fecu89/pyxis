import "server-only";

import { boardAcceptsGuestComments, boardAcceptsGuestPosts, guestOwnsContent } from "@/lib/auth/authorization";
import { readGuestSession, type GuestSession } from "@/lib/board/guest-session";

/**
 * 손님이 이 글을 건드려도 되는지 한곳에서 판정합니다. 글 수정·삭제, 첨부 추가·삭제·정렬이
 * 모두 같은 질문을 하므로 라우트마다 따로 쓰지 않고 여기로 모읍니다.
 *
 * 통과 조건 셋을 **매 요청** 확인합니다.
 *  ① 보드가 지금도 손님 글쓰기를 받는가 — 교사가 꺼 두면 손님의 편집 권한도 같이 닫힙니다.
 *  ② 이 보드의 손님 쿠키가 있고 서명이 맞는가
 *  ③ 그 글이 정말 이 손님이 쓴 글인가
 *
 * ①을 캐시하거나 쿠키에 담아 두지 않는 게 핵심입니다. 쿠키는 신분증일 뿐이고 권한은 언제나
 * 보드 설정에서 다시 나옵니다.
 */
export async function resolveGuestPostOwner(
  boardId: string,
  board: Parameters<typeof boardAcceptsGuestPosts>[0],
  post: { authorId: string | null; guestId: string | null },
): Promise<GuestSession | null> {
  if (!boardAcceptsGuestPosts(board)) return null;
  const guest = await readGuestSession(boardId);
  return guest && guestOwnsContent(post, guest.guestId) ? guest : null;
}

/**
 * 손님이 자기 댓글을 고치거나 지울 수 있는지. 글과 같은 세 가지를 확인하되, 문은 댓글 쪽
 * (`boardAcceptsGuestComments`)입니다 — 보드가 댓글을 꺼 두면 손님 댓글도 손댈 수 없습니다.
 */
export async function resolveGuestCommentOwner(
  boardId: string,
  board: Parameters<typeof boardAcceptsGuestComments>[0],
  comment: { authorId: string | null; guestId: string | null },
): Promise<GuestSession | null> {
  if (!boardAcceptsGuestComments(board)) return null;
  const guest = await readGuestSession(boardId);
  return guest && guestOwnsContent(comment, guest.guestId) ? guest : null;
}
