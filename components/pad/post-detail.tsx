"use client";

import { useCallback, useEffect, useMemo, useState, type CSSProperties } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import dynamic from "next/dynamic";
import { ArrowLeft, LoaderCircle, MessageCircle, Pencil, Pin, Trash2 } from "lucide-react";
import { AttachmentViewer } from "@/components/pad/attachments/attachment-viewer";
import type { AttachmentMetadataInput, AttachmentViewData } from "@/components/pad/attachments/types";
import { buildMentionCandidates } from "@/components/pad/comments/comment-context";
import { ThreadedComments } from "@/components/pad/comments/threaded-comments";
import { usePostComments } from "@/components/pad/comments/use-post-comments";
import { useGuestIdentity } from "@/components/pad/guest-identity";
import { LazyPostComposer, preloadPostComposer } from "@/components/pad/lazy-post-composer";
import { PadMoreMenu } from "@/components/pad/pad-more-menu";
import { referencedAttachmentIds } from "@/components/pad/post-content-blocks";
import { ReactionBar } from "@/components/pad/reactions/reaction-bar";
import { PostCustomFieldsDisplay } from "@/components/pad/settings/post-custom-fields-display";
import type { PostFieldValues } from "@/components/pad/settings/types";
import { Avatar } from "@/components/ui/avatar";
import { useConfirm } from "@/components/ui/app-dialog";
import { ThemeToggle } from "@/components/ui/theme-toggle";
// react-markdown + remark/rehype 체인은 이 라우트에서 가장 무거운 의존성입니다. 서버 렌더링은
// 그대로 두고(본문이 첫 화면의 주 내용이라 지연 렌더하면 깜빡임·CLS가 생김) 클라이언트 청크만
// 분리해, 댓글·반응·작성기 같은 상호작용 코드의 하이드레이션이 마크다운 파서를 기다리지 않게 합니다.
const PostBody = dynamic(() => import("@/components/pad/post-body").then((mod) => mod.PostBody));
const SortableAttachmentList = dynamic(() => import("@/components/pad/attachments/sortable-attachment-list").then((mod) => mod.SortableAttachmentList), { ssr: false });
import type { PadCapabilities, PadData, PostData, ReactionKey, SectionData } from "@/components/pad/types";
import { boardRoutePath } from "@/lib/board/route-paths";
import type { ReactionCounts } from "@/lib/reactions/types";
import { requestJson } from "@/lib/api-client";
import { mergeAttachmentImage, preserveImageRevisions, upsertAttachmentImage } from "@/lib/files/attachment-url";
import { usePadEvents } from "@/components/pad/use-pad-events";

function readCustomValues(post: PostData): PostFieldValues {
  if (!post.customFieldValues) return {};
  return Object.fromEntries(Object.entries(post.customFieldValues.fields).map(([id, stored]) => [id, stored.value]));
}

type PostPageStyle = CSSProperties & { "--post-accent"?: string };

const safeColorPattern = /^#(?:[\da-f]{3}|[\da-f]{4}|[\da-f]{6}|[\da-f]{8})$/i;

export function PostDetailPage({
  board,
  section,
  post: initialPost,
  capabilities,
  currentUserId,
}: {
  board: PadData;
  section: SectionData;
  post: PostData;
  capabilities: PadCapabilities;
  currentUserId: string | null;
}) {
  const router = useRouter();
  const confirm = useConfirm();
  const boardHref = boardRoutePath(board.slug);
  const [post, setPost] = useState(initialPost);
  const [postSource, setPostSource] = useState(initialPost);
  if (postSource !== initialPost) {
    setPostSource(initialPost);
    setPost({ ...initialPost, attachments: preserveImageRevisions(post.attachments, initialPost.attachments) });
  }
  const canEdit = capabilities.editAnyPost || (capabilities.editOwnContent && post.isMine);
  const mentionCandidates = useMemo(() => buildMentionCandidates(board), [board]);
  const pageStyle: PostPageStyle = safeColorPattern.test(board.accentColor ?? "")
    ? { "--post-accent": board.accentColor! }
    : {};
  const [editing, setEditing] = useState(false);
  const [attachments, setAttachments] = useState<AttachmentViewData[]>(post.attachments);
  const [error, setError] = useState("");
  const [movePending, setMovePending] = useState(false);
  const embeddedAttachmentIds = referencedAttachmentIds(post.body);
  const looseAttachments = attachments.filter((attachment) => !embeddedAttachmentIds.has(attachment.id));
  // 카드 안의 댓글 패널과 같은 훅을 씁니다(components/pad/comments/use-post-comments.ts).
  const thread = usePostComments(post.id);
  const { load: loadComments } = thread;
  const guest = useGuestIdentity();

  usePadEvents(board.id, (event) => {
    if (event.postId !== post.id) return;
    if (event.type === "attachment.deleted") {
      setPost(current => ({ ...current, attachments: current.attachments.filter(item => item.id !== event.entityId) }));
      return;
    }
    if (event.type !== "attachment.updated" || !event.payload?.attachmentPatch) return;
    const patch = event.payload.attachmentPatch;
    const snapshot = event.payload.attachment;
    setPost(current => ({ ...current, attachments: snapshot
      ? upsertAttachmentImage(current.attachments, snapshot, patch)
      : current.attachments.map(item => item.id === patch.id ? mergeAttachmentImage(item, patch) : item) }));
  }, () => router.refresh(), currentUserId);

  // 손님은 첫 댓글 직전에 이름을 한 번 묻습니다(카드의 한 줄 입력창과 같은 흐름).
  const createComment = useCallback(async (body: string, parentId: string | null, files: File[], mentioned: string[]) => {
    if (!(await guest.ensureName())) return;
    await thread.create(body, parentId, files, mentioned);
  }, [guest, thread]);

  useEffect(() => {
    let active = true;
    queueMicrotask(() => {
      if (!active) return;
      setAttachments(current => preserveImageRevisions(current, post.attachments));
      setError("");
      void loadComments().catch((reason) => { if (active) setError(reason instanceof Error ? reason.message : "댓글을 불러오지 못했습니다."); });
    });
    return () => { active = false; };
  }, [loadComments, post.attachments]);

  async function deletePost() {
    if (!(await confirm("이 게시물을 삭제할까요? 글과 댓글은 7일 안에 복구할 수 있지만 첨부파일은 즉시 영구 삭제됩니다."))) return;
    try {
      await requestJson(`/api/posts/${post.id}`, { method: "DELETE" });
    } catch (reason) {
      return setError(reason instanceof Error ? reason.message : "게시물을 삭제하지 못했습니다.");
    }
    router.replace(boardHref);
  }

  async function deleteAttachment(attachment: AttachmentViewData) {
    if (!(await confirm("이 파일을 영구 삭제할까요? 삭제한 파일은 복구할 수 없습니다."))) return;
    await requestJson(`/api/attachments/${attachment.id}`, { method: "DELETE" });
    setAttachments((current) => current.filter((item) => item.id !== attachment.id));
    setPost((current) => ({ ...current, attachments: current.attachments.filter((item) => item.id !== attachment.id) }));
  }

  async function updateAttachmentMetadata(attachmentId: string, value: AttachmentMetadataInput) {
    const result = await requestJson<{ attachment: Partial<AttachmentViewData> }>(`/api/attachments/${attachmentId}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(value) });
    setAttachments((current) => current.map((item) => item.id === attachmentId ? { ...item, ...result.attachment } : item));
    setPost((current) => ({
      ...current,
      attachments: current.attachments.map((item) => item.id === attachmentId
        ? {
            ...item,
            ...(result.attachment.altText !== undefined ? { altText: result.attachment.altText } : {}),
            ...(result.attachment.caption !== undefined ? { caption: result.attachment.caption } : {}),
          }
        : item),
    }));
  }

  async function reorderLooseAttachments(orderedLooseIds: string[]) {
    if (movePending) return;
    const previous = attachments;
    const looseById = new Map(looseAttachments.map((attachment) => [attachment.id, attachment]));
    if (orderedLooseIds.length !== looseById.size || orderedLooseIds.some((id) => !looseById.has(id))) return;
    let looseIndex = 0;
    // API는 본문 배치 첨부까지 포함한 전체 순서를 요구합니다. 드래그 대상이 아닌 본문 첨부의
    // 슬롯은 그대로 두고, 기존의 미배치 슬롯에만 사용자가 만든 순서를 다시 채웁니다.
    const next = previous.map((attachment) => {
      if (embeddedAttachmentIds.has(attachment.id)) return attachment;
      const nextLoose = looseById.get(orderedLooseIds[looseIndex]);
      looseIndex += 1;
      return nextLoose ?? attachment;
    });
    setAttachments(next);
    const nextOrder = new Map(next.map((item, itemIndex) => [item.id, itemIndex]));
    setPost((current) => ({
      ...current,
      attachments: [...current.attachments].sort((left, right) => (nextOrder.get(left.id) ?? 0) - (nextOrder.get(right.id) ?? 0)),
    }));
    setMovePending(true);
    try {
      await requestJson(`/api/posts/${post.id}/attachments/reorder`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ attachmentIds: next.map((item) => item.id) }) });
    } catch (reason) {
      setAttachments(previous);
      const previousOrder = new Map(previous.map((item, itemIndex) => [item.id, itemIndex]));
      setPost((current) => ({
        ...current,
        attachments: [...current.attachments].sort((left, right) => (previousOrder.get(left.id) ?? 0) - (previousOrder.get(right.id) ?? 0)),
      }));
      setError(reason instanceof Error ? reason.message : "첨부 순서를 바꾸지 못했습니다.");
    } finally {
      setMovePending(false);
    }
  }

  async function toggleReaction(key: ReactionKey, active: boolean): Promise<ReactionCounts> {
    const result = await requestJson<{ reactionCounts: ReactionCounts }>(`/api/posts/${post.id}/reactions`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ key, active }) });
    return result.reactionCounts;
  }

  return (
    <main className="post-page" data-font={board.font} style={pageStyle}>
      <header className="post-page-nav">
        <Link href={boardHref} className="post-page-back" aria-label="패드로 돌아가기"><ArrowLeft size={18} /><span>패드로 돌아가기</span></Link>
        <strong className="post-page-context" title={board.title}>{board.title}</strong>
        <div className="post-page-nav-actions">
          <ThemeToggle />
        </div>
      </header>

      <div className="post-page-shell">
        <div className="post-page-layout">
          <article className={`post-page-article ${editing ? "editing" : ""}`}>
            {editing ? (
              <LazyPostComposer
                open
                onClose={() => setEditing(false)}
                sectionId={section.id}
                sectionTitle={section.title}
                fieldConfig={board.postFieldConfig}
                post={post}
                presentation="inline"
                onSaved={(savedPost) => {
                  setPost((current) => ({
                    ...savedPost,
                    attachments: preserveImageRevisions(current.attachments, savedPost.attachments),
                    viewerReacted: current.viewerReacted,
                    viewerReactions: current.viewerReactions,
                  }));
                  setAttachments(current => preserveImageRevisions(current, savedPost.attachments));
                }}
              />
            ) : <>
              <header className="post-page-heading">
              <div className="post-page-heading-top">
                <div className="post-page-labels">
                  <span className="post-section-label">{section.title}</span>
                  {post.isPinned && <span className="pinned-label"><Pin size={12} />상단 고정</span>}
                  {post.status !== "PUBLISHED" && <span className={`post-page-status ${post.status.toLowerCase()}`}>{post.status === "PENDING" ? "승인 대기" : "게시 거절"}</span>}
                </div>
                {canEdit && (
                  <PadMoreMenu
                    ariaLabel="게시물 관리"
                    className="post-heading-menu-trigger"
                    rootClassName="post-page-owner-menu"
                    items={[
                      { key: "edit", label: "게시물 수정", icon: <Pencil size={15} />, onClick: () => { preloadPostComposer(); setEditing(true); } },
                      { key: "delete", label: "게시물 삭제", icon: <Trash2 size={15} />, tone: "danger", onClick: () => { void deletePost(); } },
                    ]}
                  />
                )}
              </div>
              <h1>{post.title || "제목 없는 생각"}</h1>
              <div className="post-page-author">
                <Avatar name={post.author.name} image={post.author.image} size="medium" />
                <span><b>{post.author.name || "익명의 친구"}</b>{post.author.isGuest && <span className="guest-tag" title="로그인하지 않고 이름만 남긴 사람이에요.">손님</span>}<time dateTime={post.createdAt}>{new Intl.DateTimeFormat("ko", { year: "numeric", month: "long", day: "numeric", timeZone: "Asia/Seoul" }).format(new Date(post.createdAt))}</time></span>
              </div>
            </header>

            <div className="post-page-body">
              {looseAttachments.length > 0 && (
                <div className="post-page-attachments post-page-attachments-before">
                  {canEdit && looseAttachments.length > 1
                    ? <SortableAttachmentList attachments={looseAttachments} canDownload={capabilities.downloadAttachments} canEdit movePending={movePending} onDelete={deleteAttachment} onReorder={reorderLooseAttachments} onUpdateMetadata={updateAttachmentMetadata} />
                    : <AttachmentViewer attachments={looseAttachments} canDownload={capabilities.downloadAttachments} canEdit={canEdit} onDelete={deleteAttachment} onUpdateMetadata={updateAttachmentMetadata} />}
                </div>
              )}
              {post.body.trim() ? (
                <PostBody
                  body={post.body}
                  attachments={attachments}
                  canDownload={capabilities.downloadAttachments}
                  canEditAttachments={canEdit}
                  onDeleteAttachment={deleteAttachment}
                  onUpdateAttachmentMetadata={updateAttachmentMetadata}
                />
              ) : null}
              <PostCustomFieldsDisplay config={board.postFieldConfig} values={readCustomValues(post)} />
              <div className="post-page-reactions">
                <ReactionBar counts={post.reactionCounts} viewerReactions={post.viewerReactions} policy={board.reactionPolicy} canReact={capabilities.react} onToggle={toggleReaction} />
              </div>
            </div>
            </>}
          </article>

          <aside className="comments-panel post-page-comments">
            <header><MessageCircle size={18} /><b>댓글</b><span>{Math.max(post.commentCount, thread.comments.length)}</span></header>
            <div className="comments-scroll">
              {thread.loading && !thread.comments.length ? <div className="comments-empty"><LoaderCircle className="spin" />댓글을 불러오는 중</div> : <ThreadedComments comments={thread.comments} currentUserId={currentUserId} canComment={capabilities.comment} canEditOwn={capabilities.editOwnContent} canModerate={capabilities.moderateComments} mentionCandidates={mentionCandidates} hasMore={thread.hasMore} loadingMore={thread.loadingMore} onLoadMore={thread.loadMore} onCreate={createComment} onUpdate={thread.update} onDelete={thread.remove} />}
              {error && <p className="form-error compact" role="alert">{error}</p>}
            </div>
          </aside>
        </div>
      </div>
    </main>
  );
}
