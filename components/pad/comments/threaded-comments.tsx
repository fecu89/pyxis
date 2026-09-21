"use client";

import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type FormEvent,
  type KeyboardEvent,
} from "react";
import { AtSign, LoaderCircle, MessageCircle, MessageSquarePlus, Pencil, Send, Trash2, X } from "lucide-react";
import { formatCommentTime, renderCommentBody } from "@/components/pad/comments/comment-format";
import { Avatar } from "@/components/ui/avatar";
import { useConfirm } from "@/components/ui/app-dialog";
import { AttachmentViewer } from "@/components/pad/attachments/attachment-viewer";
import { CommentAttachmentInput } from "@/components/pad/comments/comment-attachment-input";
import styles from "@/components/pad/comments/threaded-comments.module.css";
import type { CommentMentionCandidate, ThreadCommentData } from "@/components/pad/comments/types";

type MentionOption = CommentMentionCandidate & { token: string };
type MentionSearch = { start: number; end: number; query: string };

function mentionToken(name: string) {
  return `@${name.trim().replace(/\s+/g, "_")}`;
}

function normalizeMentionQuery(value: string) {
  return value.replaceAll("_", " ").trim().toLocaleLowerCase("ko");
}

function findMentionSearch(value: string, caret: number | null): MentionSearch | null {
  if (caret === null) return null;
  const beforeCaret = value.slice(0, caret);
  const match = beforeCaret.match(/(?:^|\s)@([\p{L}\p{N}_.-]*)$/u);
  if (!match) return null;
  const start = beforeCaret.lastIndexOf("@");
  return { start, end: caret, query: normalizeMentionQuery(match[1]) };
}

export function ThreadedComments({
  comments,
  currentUserId,
  canComment,
  canEditOwn = true,
  canModerate = false,
  mentionCandidates = [],
  hasMore = false,
  loadingMore = false,
  onLoadMore,
  onCreate,
  onUpdate,
  onDelete,
}: {
  comments: ThreadCommentData[];
  currentUserId: string | null;
  canComment: boolean;
  canEditOwn?: boolean;
  canModerate?: boolean;
  mentionCandidates?: CommentMentionCandidate[];
  hasMore?: boolean;
  loadingMore?: boolean;
  onLoadMore?: () => void;
  onCreate: (body: string, parentId: string | null, attachments: File[], mentionedUserIds: string[]) => Promise<unknown>;
  onUpdate?: (commentId: string, body: string, mentionedUserIds: string[]) => Promise<unknown>;
  onDelete: (commentId: string) => Promise<unknown>;
}) {
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const composerRef = useRef<HTMLFormElement>(null);
  const orderedComments = useMemo(
    () => [...comments].sort((left, right) => (
      left.createdAt.localeCompare(right.createdAt) || left.id.localeCompare(right.id)
    )),
    [comments],
  );
  const mentionOptions = useMemo<MentionOption[]>(() => {
    const candidates = new Map<string, MentionOption>();
    for (const candidate of mentionCandidates) {
      if (!candidate.name.trim() || candidate.id === currentUserId) continue;
      candidates.set(candidate.id, { ...candidate, token: mentionToken(candidate.name) });
    }
    for (const comment of comments) {
      if (comment.author.mentionable === false || !comment.author.name?.trim() || comment.author.id === currentUserId) continue;
      candidates.set(comment.author.id, {
        id: comment.author.id,
        name: comment.author.name,
        token: mentionToken(comment.author.name),
      });
    }
    return Array.from(candidates.values()).sort((left, right) => left.name.localeCompare(right.name, "ko"));
  }, [comments, currentUserId, mentionCandidates]);
  const confirm = useConfirm();
  const [editingId, setEditingId] = useState<string | null>(null);
  const [replyTarget, setReplyTarget] = useState<CommentMentionCandidate | null>(null);
  const [draft, setDraft] = useState("");
  const [attachments, setAttachments] = useState<File[]>([]);
  const [mentionedUserIds, setMentionedUserIds] = useState<string[]>([]);
  const [mentionSearch, setMentionSearch] = useState<MentionSearch | null>(null);
  const [activeSuggestion, setActiveSuggestion] = useState(0);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const suggestions = useMemo(() => {
    if (!mentionSearch) return [];
    return mentionOptions
      .filter((candidate) => {
        if (!mentionSearch.query) return true;
        const normalizedName = candidate.name.toLocaleLowerCase("ko");
        const normalizedToken = normalizeMentionQuery(candidate.token.slice(1));
        return normalizedName.includes(mentionSearch.query) || normalizedToken.includes(mentionSearch.query);
      })
      .slice(0, 6);
  }, [mentionOptions, mentionSearch]);

  useEffect(() => {
    function scrollToCommentHash() {
      const id = decodeURIComponent(window.location.hash.slice(1));
      if (!id.startsWith("comment-")) return;
      document.getElementById(id)?.scrollIntoView({ behavior: "smooth", block: "center" });
    }
    scrollToCommentHash();
    window.addEventListener("hashchange", scrollToCommentHash);
    return () => window.removeEventListener("hashchange", scrollToCommentHash);
  }, [comments]);

  function focusComposer() {
    requestAnimationFrame(() => {
      composerRef.current?.scrollIntoView({ behavior: "smooth", block: "nearest" });
      textareaRef.current?.focus();
    });
  }

  function startReply(comment: ThreadCommentData) {
    if (!comment.author.name) return;
    const target = { id: comment.author.id, name: comment.author.name };
    const token = mentionToken(comment.author.name);
    setEditingId(null);
    setReplyTarget(target);
    setDraft(`${token} `);
    setAttachments([]);
    setMentionedUserIds(comment.author.id === currentUserId ? [] : [comment.author.id]);
    setMentionSearch(null);
    setError("");
    focusComposer();
  }

  function startEdit(comment: ThreadCommentData) {
    setReplyTarget(null);
    setEditingId(comment.id);
    setDraft(comment.body);
    setAttachments([]);
    setMentionedUserIds(comment.mentionedUserIds ?? []);
    setMentionSearch(null);
    setError("");
    focusComposer();
  }

  function resetComposer() {
    setReplyTarget(null);
    setEditingId(null);
    setDraft("");
    setAttachments([]);
    setMentionedUserIds([]);
    setMentionSearch(null);
    setActiveSuggestion(0);
    setError("");
  }

  function updateMentionSearch(value: string, caret: number | null) {
    setMentionSearch(findMentionSearch(value, caret));
    setActiveSuggestion(0);
  }

  function insertMention(candidate: MentionOption) {
    const input = textareaRef.current;
    const search = mentionSearch ?? findMentionSearch(draft, input?.selectionStart ?? draft.length);
    const nextDraft = search
      ? `${draft.slice(0, search.start)}${candidate.token} ${draft.slice(search.end)}`
      : `${draft}${draft && !draft.endsWith(" ") ? " " : ""}${candidate.token} `;
    const nextCaret = search ? search.start + candidate.token.length + 1 : nextDraft.length;
    setDraft(nextDraft);
    setMentionedUserIds((current) => current.includes(candidate.id) ? current : [...current, candidate.id]);
    setMentionSearch(null);
    requestAnimationFrame(() => {
      input?.focus();
      input?.setSelectionRange(nextCaret, nextCaret);
    });
  }

  function handleComposerKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (!mentionSearch || !suggestions.length) return;
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      const direction = event.key === "ArrowDown" ? 1 : -1;
      setActiveSuggestion((current) => (current + direction + suggestions.length) % suggestions.length);
      return;
    }
    if (event.key === "Enter" || event.key === "Tab") {
      event.preventDefault();
      insertMention(suggestions[activeSuggestion] ?? suggestions[0]);
      return;
    }
    if (event.key === "Escape") {
      event.preventDefault();
      setMentionSearch(null);
    }
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const body = draft.trim();
    if (!body) return;
    const activeMentionIds = mentionOptions
      .filter((candidate) => mentionedUserIds.includes(candidate.id) && body.includes(candidate.token))
      .map((candidate) => candidate.id);
    setSubmitting(true);
    setError("");
    try {
      if (editingId && onUpdate) await onUpdate(editingId, body, activeMentionIds);
      else await onCreate(body, null, attachments, activeMentionIds);
      resetComposer();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "댓글을 저장하지 못했습니다.");
    } finally {
      setSubmitting(false);
    }
  }

  async function removeComment(commentId: string) {
    if (!(await confirm("이 댓글을 삭제할까요? 댓글은 7일 안에 복구할 수 있지만 첨부파일은 즉시 영구 삭제됩니다."))) return;
    setError("");
    try {
      await onDelete(commentId);
      if (editingId === commentId) resetComposer();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "댓글을 삭제하지 못했습니다.");
    }
  }

  return (
    <section className={styles.root} aria-label="댓글">
      {hasMore && onLoadMore && (
        <button type="button" className={styles.loadMore} onClick={onLoadMore} disabled={loadingMore}>
          {loadingMore && <LoaderCircle size={14} className="spin" />}
          {loadingMore ? "불러오는 중..." : "이전 댓글 더 보기"}
        </button>
      )}

      {orderedComments.length ? (
        <div className={styles.list}>
          {orderedComments.map((comment) => {
            // 손님 댓글은 작성자 식별자를 화면에 내리지 않으므로(내리면 남의 손님 신분을 알게
            // 됩니다) 서버가 준 isMine을 씁니다. 계정 댓글은 예전처럼 id로도 맞아떨어집니다.
            const isMine = comment.isMine ?? currentUserId === comment.author.id;
            const canEdit = Boolean(onUpdate && canEditOwn && isMine);
            const canRemove = canModerate || (canEditOwn && isMine);
            // 손님은 계정이 없어 멘션 대상이 될 수 없습니다.
            const canReply = Boolean(canComment && comment.author.name && !comment.author.isGuest && !isMine);
            return (
              <article className={styles.comment} id={`comment-${comment.id}`} key={comment.id}>
                <Avatar name={comment.author.name} image={comment.author.image} />
                <div className={styles.bubble}>
                  <header className={styles.meta}>
                    <strong>{comment.author.name || "이름 없는 친구"}</strong>
                    {comment.author.isGuest && <span className="guest-tag" title="로그인하지 않고 이름만 남긴 사람이에요.">손님</span>}
                    <time dateTime={comment.createdAt}>{formatCommentTime(comment.createdAt)}</time>
                  </header>
                  <p className={styles.body}>{renderCommentBody(comment.body, styles.mention, styles.link)}</p>
                  {comment.attachments && comment.attachments.length > 0 && (
                    <AttachmentViewer attachments={comment.attachments} canDownload={false} />
                  )}
                  {(canReply || canEdit || canRemove) && (
                    <footer className={styles.actions}>
                      {canReply && (
                        <button type="button" onClick={() => startReply(comment)}>
                          <AtSign size={12} /> 언급하여 답장
                        </button>
                      )}
                      {canEdit && <button type="button" onClick={() => startEdit(comment)}><Pencil size={12} /> 수정</button>}
                      {canRemove && (
                        <button type="button" className={styles.danger} onClick={() => removeComment(comment.id)}>
                          <Trash2 size={12} /> 삭제
                        </button>
                      )}
                    </footer>
                  )}
                </div>
              </article>
            );
          })}
        </div>
      ) : (
        <div className={styles.empty}>
          <MessageCircle size={24} />
          <strong>아직 댓글이 없어요</strong>
          <span>첫 번째 응원이나 질문을 남겨보세요.</span>
        </div>
      )}

      {(canComment || editingId) && (
        <form className={styles.composer} ref={composerRef} onSubmit={submit}>
          <header className={styles.composerHeader}>
            <span className={styles.composerIcon} aria-hidden>
              {editingId ? <Pencil size={16} /> : <MessageSquarePlus size={16} />}
            </span>
            <div>
              <strong>{editingId ? "댓글 수정" : "댓글 남기기"}</strong>
              <span><AtSign size={12} /> 뒤에 이름을 입력하면 친구를 언급할 수 있어요.</span>
            </div>
          </header>

          {replyTarget && (
            <div className={styles.replyContext}>
              <AtSign size={13} />
              <span><b>{replyTarget.name}</b>님에게 답장하는 중</span>
              <button type="button" aria-label="답장 취소" onClick={resetComposer}><X size={14} /></button>
            </div>
          )}

          <div className={styles.editor}>
            <textarea
              ref={textareaRef}
              value={draft}
              onChange={(event) => {
                setDraft(event.currentTarget.value);
                updateMentionSearch(event.currentTarget.value, event.currentTarget.selectionStart);
              }}
              onClick={(event) => updateMentionSearch(event.currentTarget.value, event.currentTarget.selectionStart)}
              onKeyUp={(event) => {
                if (["ArrowDown", "ArrowUp", "Enter", "Tab", "Escape"].includes(event.key)) return;
                updateMentionSearch(event.currentTarget.value, event.currentTarget.selectionStart);
              }}
              onKeyDown={handleComposerKeyDown}
              placeholder={editingId ? "댓글 내용을 수정하세요." : "이 글에 대한 생각이나 응원을 남겨보세요."}
              aria-label={editingId ? "댓글 수정 내용" : "새 댓글 내용"}
              role="combobox"
              aria-autocomplete="list"
              aria-expanded={Boolean(mentionSearch && suggestions.length)}
              aria-controls="comment-mention-suggestions"
              maxLength={2000}
              required
            />
            {mentionSearch && suggestions.length > 0 && (
              <div className={styles.mentionMenu} id="comment-mention-suggestions" role="listbox" aria-label="언급할 사용자">
                <div className={styles.mentionMenuLabel}><AtSign size={12} /> 언급할 사람</div>
                {suggestions.map((candidate, index) => (
                  <button
                    type="button"
                    role="option"
                    aria-selected={index === activeSuggestion}
                    className={index === activeSuggestion ? styles.activeSuggestion : undefined}
                    key={candidate.id}
                    onMouseDown={(event) => event.preventDefault()}
                    onClick={() => insertMention(candidate)}
                  >
                    <Avatar name={candidate.name} />
                    <span><strong>{candidate.name}</strong><small>{candidate.token}</small></span>
                  </button>
                ))}
              </div>
            )}
            <span className={styles.characterCount}>{draft.length.toLocaleString("ko")} / 2,000</span>
          </div>

          {!editingId && (
            <CommentAttachmentInput files={attachments} disabled={submitting} guestOnly={!currentUserId} onChange={setAttachments} />
          )}

          <footer className={styles.composerFooter}>
            <span>Enter는 줄바꿈 · 멘션 선택은 ↑↓와 Enter</span>
            {(editingId || replyTarget) && (
              <button type="button" className="button ghost" disabled={submitting} onClick={resetComposer}>취소</button>
            )}
            <button className="button primary" disabled={submitting || !draft.trim()}>
              {submitting ? <LoaderCircle className="spin" size={14} /> : <Send size={14} />}
              {editingId ? "수정 저장" : "댓글 등록"}
            </button>
          </footer>
          {error && <p className={styles.error} role="alert">{error}</p>}
        </form>
      )}

      {!canComment && !editingId && (
        <p className={styles.readOnly}>이 게시물의 댓글을 읽을 수 있지만 새 댓글을 작성할 권한은 없어요.</p>
      )}
    </section>
  );
}
