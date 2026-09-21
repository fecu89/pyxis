import { EventEmitter } from "node:events";
import type { AttachmentData, CardComment, PadData, PostData, SectionData } from "@/components/pad/types";
import type { ReactionCounts, ReactionKey } from "@/lib/reactions/types";

export type BoardEventPayload = {
  reactionCount?: number;
  reactionCounts?: ReactionCounts;
  /** 반응 요청을 보낸 연결에만 전달되는 그 사용자의 최신 반응 목록입니다. */
  actorReactions?: ReactionKey[];
  commentCount?: number;
  /** 고정 여부처럼 카드 배치 규칙 자체를 바꾼 수정인지. 본문·첨부 검증 갱신과 구분합니다. */
  layoutChanged?: boolean;
  /** 생성·본문 수정·승인·복구 뒤의 공개 카드 스냅샷. viewer 전용 값은 수신자가 보존합니다. */
  post?: PostData;
  /** 카드 댓글의 생성 델타. 수정·삭제는 commentId와 commentPatch/commentCount를 사용합니다. */
  comment?: CardComment;
  commentPatch?: { id: string; body?: string };
  /** 게시물 첨부 생성/복구 델타. 댓글 상세 첨부에는 넣지 않습니다. */
  attachment?: AttachmentData;
  /** 댓글 첨부는 게시물 첨부 배열이 아니라 해당 카드 댓글에 합칩니다. */
  commentAttachment?: { commentId: string; attachment: AttachmentData };
  commentAttachmentPatch?: { commentId: string; attachmentPatch: Partial<AttachmentData> & { id: string } };
  commentAttachmentDeleted?: { commentId: string; attachmentId: string };
  attachmentPatch?: Partial<AttachmentData> & { id: string };
  attachmentIds?: string[];
  /** 서버가 확정한 위치와 버전. 다른 사용자의 낙관적 배열에도 이 값만 반영합니다. */
  postMove?: {
    sectionId: string;
    position: number;
    version: number;
    previousItemId: string | null;
    nextItemId: string | null;
  };
  section?: SectionData;
  sectionPatch?: Partial<Pick<SectionData, "title" | "description" | "position" | "version">> & { id: string };
  sectionMove?: {
    position: number;
    version: number;
    previousItemId: string | null;
    nextItemId: string | null;
  };
  /** 설정 변경처럼 공개해도 되는 보드 필드만 부분 갱신합니다. */
  boardPatch?: Partial<Omit<PadData, "sections" | "members" | "owner">>;
  /** 멤버·접근권한처럼 사용자별 capability를 다시 판정해야 하는 드문 변경입니다. */
  requiresSync?: boolean;
};

export type BoardEvent = {
  type:
    | "post.created" | "post.updated" | "post.deleted" | "post.reordered"
    | "section.created" | "section.updated" | "section.deleted" | "section.reordered"
    | "attachment.created" | "attachment.updated" | "attachment.deleted"
    | "comment.created" | "comment.updated" | "comment.deleted" | "reaction.changed" | "board.updated";
  entityId: string;
  actorId?: string;
  sectionId?: string | null;
  postId?: string | null;
  // 이 변경과 함께 기록된 BoardActivity.id. 활동 패널/알림과 이벤트를 추적할 때 연결합니다.
  activityId?: string;
  payload?: BoardEventPayload;
  /**
   * 서버 SSE 라우트가 구독자별 공개 범위와 isMine을 계산할 때만 쓰는 내부 메타데이터입니다.
   * wire payload를 만들 때 반드시 제거하며, 승인 대기 글의 내용이 일반 구독자에게 새지 않게 합니다.
   */
  delivery?: {
    public: boolean;
    authorUserId?: string | null;
    authorGuestId?: string | null;
    recipientUserIds?: Array<string | null>;
    recipientGuestIds?: Array<string | null>;
  };
  emittedAt?: string;
};

const globalForEvents = globalThis as unknown as { pyxCourseEventBus?: EventEmitter };

function getEventBus() {
  if (!globalForEvents.pyxCourseEventBus) {
    const bus = new EventEmitter();
    bus.setMaxListeners(0);
    globalForEvents.pyxCourseEventBus = bus;
  }
  return globalForEvents.pyxCourseEventBus;
}

const channel = (boardId: string) => `board:${boardId}`;

export function publishBoardEvent(boardId: string, event: BoardEvent) {
  getEventBus().emit(channel(boardId), { ...event, emittedAt: new Date().toISOString() } satisfies BoardEvent);
}

export function subscribeBoardEvent(boardId: string, listener: (event: BoardEvent) => void) {
  const bus = getEventBus();
  const name = channel(boardId);
  bus.on(name, listener);
  return () => bus.off(name, listener);
}
