import "server-only";

import type { Prisma } from "@/generated/prisma/client";
import { toPublicAuthorDTO, type PublicAuthorDTO } from "@/lib/users/repository";

/**
 * 글의 작성자는 **로그인 사용자이거나 비로그인 손님**입니다(둘 중 정확히 하나 — DB CHECK로 강제).
 * 화면과 권한 판정이 그 두 경우를 매번 따로 다루면 어딘가는 반드시 빠뜨리므로 여기로 모읍니다.
 */

export type PostAuthorDTO = PublicAuthorDTO & {
  /** 계정 없이 쓴 글이면 true. 화면에서 "손님" 표시를 붙이는 근거입니다. */
  isGuest: boolean;
};

type AuthorSource = {
  author: { id: string; nameEncrypted: string | null; imageEncrypted: string | null } | null;
  guestName: string | null;
};

/** 카드·상세·내보내기가 함께 쓰는 작성자 표시. 손님은 계정이 없으므로 id가 빈 문자열입니다. */
export function toPostAuthorDTO(post: AuthorSource): PostAuthorDTO {
  if (post.author) return { ...toPublicAuthorDTO(post.author), isGuest: false };
  return { id: "", name: post.guestName ?? "손님", image: null, isGuest: true };
}

/**
 * 댓글 작성자 표시. 글과 같은 규칙입니다 — 계정이면 복호화한 이름, 손님이면 남긴 이름.
 * 손님은 계정이 없으므로 id가 빈 문자열이고, 멘션 대상이 될 수 없습니다(mentionable: false).
 */
export function toCommentAuthorDTO(comment: {
  author: { id: string; nameEncrypted: string | null; imageEncrypted: string | null; status?: "ACTIVE" | "SUSPENDED" | "DELETED" } | null;
  guestName: string | null;
}) {
  if (comment.author) {
    return {
      ...toPublicAuthorDTO(comment.author),
      isGuest: false,
      mentionable: comment.author.status === undefined || comment.author.status === "ACTIVE",
    };
  }
  return { id: "", name: comment.guestName ?? "손님", image: null, isGuest: true, mentionable: false };
}

export type PostOwnership = { authorId: string | null; guestId: string | null };
export type Viewer = { userId: string | null; guestId: string | null };

/**
 * 이 글을 쓴 당사자인가. 로그인 사용자와 손님을 **섞지 않습니다** — 손님 쿠키를 들고 있다고
 * 남의 계정 글을 건드릴 수 없고, 반대도 마찬가지입니다.
 */
export function isPostAuthor(post: PostOwnership, viewer: Viewer): boolean {
  if (post.authorId !== null) return viewer.userId !== null && post.authorId === viewer.userId;
  return viewer.guestId !== null && post.guestId !== null && post.guestId === viewer.guestId;
}

/**
 * 카드에 바로 보여 줄 댓글입니다. 게시물을 열지 않아도 대화가 다 보이도록 **한 페이지 분량을
 * 통째로** 싣습니다 — 글 하나에 댓글이 20개를 넘는 일은 거의 없어서, 접었다 펴는 단계를 두는
 * 것보다 처음부터 다 보여 주는 편이 낫습니다.
 *
 * 값은 댓글 API의 한 페이지(COMMENT_PAGE_SIZE)와 같습니다. 넘어가는 드문 경우에는 최신 20개를
 * 싣고 카드가 "이전 댓글은 게시물에서" 한 줄을 덧붙입니다 — 조용히 잘라내지 않습니다.
 *
 * 비용은 재 봤습니다. 이름 복호화(AES-GCM)는 600회에 17.6ms이고, 그 600회는 게시물 30개가
 * 저마다 댓글 20개를 가진 최악의 경우입니다. 중첩 take라 SQL도 게시물 수와 무관하게 댓글
 * 조회 1개 + 작성자 조회 1개만 늘어납니다(실제로 나가는 문장을 세어 확인했습니다).
 */
export const CARD_COMMENT_LIMIT = 20;

// `as const`를 쓰면 orderBy 배열이 readonly 튜플이 되어 Prisma가 받지 않습니다. satisfies로
// 형태만 검사하고 타입은 Prisma가 기대하는 그대로 둡니다.
export const cardCommentSelect = {
  where: { deletedAt: null },
  orderBy: [{ createdAt: "desc" }, { id: "desc" }],
  take: CARD_COMMENT_LIMIT,
  select: {
    id: true,
    body: true,
    createdAt: true,
    author: { select: { id: true, nameEncrypted: true, imageEncrypted: true } },
    // 손님 댓글 표시 이름과 소유 판정용. guestId는 DTO로 나가지 않습니다.
    guestName: true,
    guestId: true,
    authorId: true,
    attachments: {
      where: { deletedAt: null },
      orderBy: { sortOrder: "asc" },
      select: { id: true, type: true, originalName: true, mimeType: true, fileSize: true, width: true, height: true, altText: true, caption: true, externalUrl: true, previewImageUrl: true },
    },
  },
} satisfies Prisma.Post$commentsArgs;

export type CardCommentSource = {
  id: string;
  body: string;
  createdAt: Date;
  authorId: string | null;
  guestId: string | null;
  guestName: string | null;
  author: { id: string; nameEncrypted: string | null; imageEncrypted: string | null } | null;
  attachments: Array<{
    id: string;
    type: "IMAGE" | "PDF" | "DOCUMENT" | "VIDEO" | "AUDIO" | "FILE" | "LINK";
    originalName: string;
    mimeType: string;
    fileSize: number;
    width: number | null;
    height: number | null;
    altText: string | null;
    caption: string | null;
    externalUrl: string | null;
    previewImageUrl: string | null;
  }>;
};

/** 최신순으로 읽어 온 목록을 화면에 보이는 순서(오래된 것부터)로 되돌립니다. */
export function toCardCommentDTO(comments: CardCommentSource[], viewer: Viewer) {
  return [...comments].reverse().map((comment) => ({
    id: comment.id,
    body: comment.body,
    createdAt: comment.createdAt.toISOString(),
    attachments: comment.attachments,
    author: toCommentAuthorDTO(comment),
    isMine: isPostAuthor({ authorId: comment.authorId, guestId: comment.guestId }, viewer),
  }));
}
