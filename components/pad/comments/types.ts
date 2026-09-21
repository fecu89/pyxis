import type { AttachmentViewData } from "@/components/pad/attachments/types";

export type CommentAuthor = {
  id: string;
  name: string | null;
  image: string | null;
  mentionable?: boolean;
  /** 계정 없이 이름만 남기고 쓴 댓글이면 true. 화면에 "손님" 표시를 붙이는 근거입니다. */
  isGuest?: boolean;
};

export type CommentMentionCandidate = {
  id: string;
  name: string;
};

export type ThreadCommentData = {
  id: string;
  body: string;
  parentId: string | null;
  createdAt: string;
  updatedAt?: string;
  mentionedUserIds?: string[];
  attachments?: AttachmentViewData[];
  author: CommentAuthor;
  /**
   * 보고 있는 사람이 이 댓글을 쓴 당사자인지. 손님 식별자는 화면으로 내려보내지 않으므로
   * (내리면 남의 손님 신분을 알게 됩니다) id 비교 대신 서버가 판정해 준 값을 씁니다.
   */
  isMine?: boolean;
};
