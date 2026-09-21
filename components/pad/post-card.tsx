"use client";
/* eslint-disable @next/next/no-img-element */

import { memo, type CSSProperties, type HTMLAttributes, type KeyboardEventHandler } from "react";
import { useParams, useRouter } from "next/navigation";
import { Clock3, FileText, GripVertical, MessageCircle, Paperclip, Pin, Play, XCircle } from "lucide-react";
import { Avatar } from "@/components/ui/avatar";
import { attachmentSummary } from "@/components/pad/attachments/file-kind";
import { PostCardComments, postCommentsVisible } from "@/components/pad/comments/post-card-comments";
import { PostBody } from "@/components/pad/post-body";
import { referencedAttachmentIds } from "@/components/pad/post-content-blocks";
import { ReactionBar } from "@/components/pad/reactions/reaction-bar";
import { PostCardActions } from "@/components/pad/post-card-actions";
import type { PadCapabilities, PostData, ReactionKey } from "@/components/pad/types";
import { boardPostRoutePath } from "@/lib/board/route-paths";
import { getLinkCardThumbnail, getLinkSourceHost } from "@/lib/link-preview/link-card";
import type { ReactionCounts } from "@/lib/reactions/types";

function findPostCover(attachments: PostData["attachments"]) {
  for (const attachment of attachments) {
    if (attachment.type === "IMAGE") {
      return {
        src: `/f/${attachment.id}?variant=thumbnail`,
        alt: attachment.altText || attachment.originalName,
        link: false,
        video: false,
        title: null,
        host: null,
      };
    }
    if (attachment.type === "LINK") {
      const thumbnail = getLinkCardThumbnail(attachment.externalUrl, attachment.previewImageUrl);
      if (thumbnail) {
        return {
          src: thumbnail.src,
          alt: "",
          link: true,
          video: thumbnail.isYouTube,
          title: attachment.originalName,
          host: getLinkSourceHost(attachment.externalUrl),
        };
      }
    }
  }
  return null;
}

const shortPostDate = new Intl.DateTimeFormat("ko", { month: "numeric", day: "numeric", timeZone: "Asia/Seoul" });

export type PostCardProps = {
  post: PostData;
  sectionId: string;
  reactionPolicy: "SINGLE" | "MULTIPLE";
  capabilities: PadCapabilities;
  showAuthor: boolean;
  showTimestamp: boolean;
  // 드래그 중 따라다니는 미리보기(DragOverlay)에서는 끕니다 — 입력창이 두 벌 생깁니다.
  showComments?: boolean;
};

/** @dnd-kit을 쓰는 레이아웃만 주입합니다. 일반 카드 청크는 이 타입 외에 DnD 코드를 모릅니다. */
export type PostCardDragBindings = {
  enabled: boolean;
  setNodeRef: (node: HTMLElement | null) => void;
  style: CSSProperties;
  isDragging: boolean;
  attributes: HTMLAttributes<HTMLElement>;
  pointerListeners: HTMLAttributes<HTMLElement>;
  keyDown: KeyboardEventHandler<HTMLSpanElement> | undefined;
  consumeClickAfterDrag: () => boolean;
};

export const PostCard = memo(function PostCard({
  post,
  reactionPolicy,
  capabilities,
  showAuthor,
  showTimestamp,
  showComments = true,
  drag,
}: PostCardProps & { drag?: PostCardDragBindings }) {
  const router = useRouter();
  const { slug } = useParams<{ slug: string }>();
  const postHref = boardPostRoutePath(slug, post.id);
  const isOwnPost = post.isMine;
  const embeddedAttachmentIds = referencedAttachmentIds(post.body);
  const looseAttachments = post.attachments.filter((attachment) => !embeddedAttachmentIds.has(attachment.id));
  const cover = findPostCover(looseAttachments);
  // 댓글 영역이 붙으면 그 안에 개수·입력창이 다 들어갑니다. 바닥 줄의 숫자는 영역이 없을 때만
  // 남겨 둡니다 — 둘 다 보이면 같은 값을 두 번 말하는 데다, 인라인으로 단 댓글이 반영된
  // 패널 쪽 숫자와 서버가 준 바닥 숫자가 서로 어긋나 보입니다.
  const commentsAttached = showComments && postCommentsVisible(post, capabilities);

  async function toggleReaction(key: ReactionKey, active: boolean): Promise<ReactionCounts> {
    const response = await fetch(`/api/posts/${post.id}/reactions`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ key, active }) });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || "반응을 저장하지 못했습니다.");
    return result.reactionCounts;
  }

  return (
    <article
      ref={drag?.setNodeRef}
      style={drag?.style}
      className={`post-card ${drag?.isDragging ? "dragging" : ""}`}
      {...(drag?.attributes ?? {})}
      {...(drag?.pointerListeners ?? {})}
      aria-disabled={undefined}
      aria-label={`게시물 열기: ${post.title || "제목 없는 생각"}`}
      onClick={(event) => {
        if (drag?.consumeClickAfterDrag()) return;
        if (!(event.target as HTMLElement).closest("button, a, input, textarea, select")) router.push(postHref);
      }}
      onKeyDown={(event) => { if (event.target === event.currentTarget && (event.key === "Enter" || event.key === " ")) { event.preventDefault(); router.push(postHref); } }}
    >
      <div className="post-card-meta">{showAuthor && <><Avatar name={post.author.name} image={post.author.image} /><span>{post.author.name || "이름 없는 친구"}</span>{post.author.isGuest && <span className="guest-tag" title="로그인하지 않고 이름만 남긴 사람이에요.">손님</span>}</>}{post.isPinned && <span className="pin"><Pin size={12} />고정</span>}{isOwnPost && post.status === "PENDING" && <span className="post-status pending" title="관리자 승인을 기다리고 있어요."><Clock3 size={12} />승인 대기</span>}{isOwnPost && post.status === "REJECTED" && <span className="post-status rejected" title={post.moderationReason ? `거절 사유: ${post.moderationReason}` : "거절됨"}><XCircle size={12} />거절됨</span>}{!isOwnPost && capabilities.moderatePosts && post.status === "PENDING" && <span className="post-status review-needed" title="승인이 필요한 글이에요."><Clock3 size={12} />검토 필요</span>}{drag?.enabled && <span className="drag-handle" role="button" tabIndex={0} aria-label="게시물 순서 이동 (스페이스바로 드래그 시작)" onKeyDown={drag.keyDown}><GripVertical size={16} /></span>}<PostCardActions post={post} /></div>
      {cover && (
        <div className={`post-cover-frame ${cover.link ? "link" : ""} ${cover.video ? "video" : ""}`}>
          <img className="post-cover" src={cover.src} alt={cover.alt} loading="lazy" referrerPolicy={cover.link ? "no-referrer" : undefined} draggable={false} />
          {cover.video && <span className="post-cover-play" aria-hidden><Play size={20} fill="currentColor" /></span>}
          {cover.link && (
            <span className="post-cover-origin" aria-hidden>
              <strong>{cover.title}</strong>
              {cover.host && <small>{cover.host}</small>}
            </span>
          )}
        </div>
      )}
      <div className="post-card-copy">
        {post.title && <h3>{post.title}</h3>}
        {post.body && <PostBody body={post.body} attachments={post.attachments} canDownload={capabilities.downloadAttachments} compact />}
      </div>
      {looseAttachments.length > 0 && <div className="post-files"><span>{looseAttachments.some((item) => item.type === "IMAGE") ? <Paperclip size={14} /> : <FileText size={14} />}{attachmentSummary(looseAttachments)}</span></div>}
      <footer><ReactionBar counts={post.reactionCounts} viewerReactions={post.viewerReactions} policy={reactionPolicy} canReact={capabilities.react} onToggle={toggleReaction} />{!commentsAttached && <span><MessageCircle size={16} />{post.commentCount || "댓글"}</span>}{showTimestamp && <time dateTime={post.createdAt}>{shortPostDate.format(new Date(post.createdAt))}</time>}</footer>
      {commentsAttached && <PostCardComments post={post} capabilities={capabilities} />}
    </article>
  );
});
