"use client";

import dynamic from "next/dynamic";
import { useRef, useState, type ChangeEvent, type FormEvent, type KeyboardEvent, type ReactNode } from "react";
import { FileAudio, FileText, Image as ImageIcon, LoaderCircle, MessageCircle, Mic, Paperclip, SendHorizontal, Trash2, X } from "lucide-react";
import { Avatar } from "@/components/ui/avatar";
import { formatCommentTime, renderCommentBody } from "@/components/pad/comments/comment-format";
import { createComment, removeComment } from "@/components/pad/comments/use-post-comments";
import { usePadCommentContext } from "@/components/pad/comments/comment-context";
import {
  commentAttachmentAccept,
  commentAttachmentKind,
  guestCommentAttachmentAccept,
  prepareCommentAttachmentFiles,
} from "@/components/pad/comments/comment-attachment-rules";
import { useAutoResizeTextarea } from "@/components/pad/comments/use-auto-resize-textarea";
import { fileKey } from "@/components/pad/attachments/file-rules";
import { useGuestIdentity } from "@/components/pad/guest-identity";
import { Modal } from "@/components/ui/modal";
import { useConfirm } from "@/components/ui/app-dialog";
import type { CardComment, PadCapabilities, PostData } from "@/components/pad/types";
import styles from "@/components/pad/comments/post-card-comments.module.css";

const CommentMediaCapture = dynamic(
  () => import("@/components/pad/attachments/media-capture").then((mod) => mod.MediaCapture),
  { ssr: false },
);

function formatFileSize(size: number) {
  if (size >= 1024 * 1024) return `${(size / 1024 / 1024).toFixed(1)}MB`;
  return `${Math.max(1, Math.ceil(size / 1024))}KB`;
}

function FileKindIcon({ file }: { file: File }) {
  const kind = commentAttachmentKind(file);
  if (kind === "IMAGE") return <ImageIcon size={14} />;
  if (kind === "AUDIO") return <FileAudio size={14} />;
  return <FileText size={14} />;
}

function PendingCommentFiles({ files, disabled, onRemove }: {
  files: File[];
  disabled: boolean;
  onRemove: (file: File) => void;
}) {
  if (!files.length) return null;
  return (
    <ul className={styles.pendingFiles} aria-label={`댓글 첨부 ${files.length}개`}>
      {files.map((file) => (
        <li key={fileKey(file)}>
          <FileKindIcon file={file} />
          <span title={file.name}>{file.name}</span>
          <small>{formatFileSize(file.size)}</small>
          <button type="button" aria-label={`${file.name} 첨부 제거`} disabled={disabled} onClick={() => onRemove(file)}>
            <X size={13} />
          </button>
        </li>
      ))}
    </ul>
  );
}

function CardCommentAttachments({ attachments }: { attachments: CardComment["attachments"] }) {
  if (!attachments.length) return null;
  return (
    <div className={styles.commentAttachments} aria-label={`댓글 첨부 ${attachments.length}개`}>
      {attachments.map((attachment) => {
        const url = `/f/${encodeURIComponent(attachment.id)}`;
        if (attachment.type === "IMAGE") {
          return (
            <a href={url} target="_blank" rel="noopener noreferrer" key={attachment.id} aria-label={`${attachment.originalName} 보기`}>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={`${url}?variant=thumbnail`} alt={attachment.altText || attachment.originalName} loading="lazy" />
            </a>
          );
        }
        if (attachment.type === "AUDIO") {
          return (
            <audio controls preload="none" key={attachment.id} aria-label={attachment.originalName}>
              <source src={url} type={attachment.mimeType} />
            </audio>
          );
        }
        return (
          <a className={styles.commentFile} href={url} target="_blank" rel="noopener noreferrer" key={attachment.id}>
            <FileText size={14} />
            <span>{attachment.originalName}</span>
          </a>
        );
      })}
    </div>
  );
}

/**
 * 카드 안에서 바로 읽고 쓰는 댓글입니다.
 *
 * 게시물을 열어야만 대화가 보이면 패드가 "글 모음"으로 끝납니다. 그래서 카드가 댓글을 **전부**
 * 띄우고(목록 조회가 함께 읽어 옵니다 — `post.comments`) 한 줄 입력창을 붙여, 화면 이동 없이
 * 읽고 답할 수 있게 했습니다.
 *
 * 접었다 펴는 단계를 두지 않습니다. 글 하나에 댓글이 20개를 넘는 일이 거의 없어서, "모두 보기"를
 * 한 번 더 누르게 해서 얻는 것보다 처음부터 다 보이는 편이 낫습니다. 그래서 카드는 **댓글을
 * 부르는 요청을 아예 만들지 않습니다** — 서버가 첫 응답에 실어 보낸 것만 그립니다.
 *
 * 손님(비로그인)도 여기서 답니다. 이름은 보낼 때 한 번만 묻고(`useGuestIdentity`), 권한은
 * 언제나 서버가 보드 설정을 다시 읽어 판단합니다.
 *
 * 멘션 자동완성·수정처럼 자리가 필요한 기능은 상세 화면(`ThreadedComments`)에 둡니다.
 * 그쪽을 카드에 그대로 넣어 봤더니 230px 폭에서 이름이 "전체관…"으로 잘리고 카드 높이가
 * 1,000px를 넘겨 되돌렸습니다.
 */

/**
 * 이 카드에 댓글 영역을 붙일지. 카드 바닥의 댓글 수 표시와 이 패널이 같은 것을 두 번 말하지
 * 않도록, 두 곳이 같은 판정을 씁니다 — 쓸 수 있거나, 이미 달린 댓글이 있으면 보여 줍니다.
 */
export function postCommentsVisible(
  post: Pick<PostData, "status" | "commentCount">,
  capabilities: Pick<PadCapabilities, "comment">,
) {
  return (capabilities.comment && post.status === "PUBLISHED") || post.commentCount > 0;
}

export function PostCardComments({ post, capabilities }: {
  post: PostData;
  capabilities: PadCapabilities;
}) {
  const confirm = useConfirm();
  const guest = useGuestIdentity();
  const { currentUserId } = usePadCommentContext();
  const guestOnly = !currentUserId;
  const [comments, setComments] = useState<CardComment[]>(post.comments);
  // 서버가 알려 준 총 개수. 한 페이지(20개)를 넘겨 잘린 경우를 알아채는 데만 씁니다.
  const [total, setTotal] = useState(post.commentCount);

  // 다른 사람이 댓글을 달면 SSE 댓글 델타가 부모 카드 목록에 바로 합쳐집니다. 그런데
  // useState의 초기값은 **처음 한 번만** 쓰이므로, 이대로 두면 새로 받은 댓글이 화면에 영원히
  // 안 나타납니다(실제로 그렇게 동작하는 것을 확인하고 고쳤습니다). 서버가 보낸 목록이 언제나
  // 정답이므로, 새 배열이 오면 지역 상태를 그쪽으로 맞춥니다.
  // 렌더 도중 setState는 React가 공식으로 권하는 "prop이 바뀌면 state 되돌리기" 패턴입니다.
  const [seed, setSeed] = useState(post.comments);
  if (seed !== post.comments) {
    setSeed(post.comments);
    setComments(post.comments);
    setTotal(post.commentCount);
  }

  const [draft, setDraft] = useState("");
  const [files, setFiles] = useState<File[]>([]);
  const [attachmentError, setAttachmentError] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState("");
  const [mobileOpen, setMobileOpen] = useState(false);
  const [captureOpen, setCaptureOpen] = useState(false);
  const desktopTextareaRef = useAutoResizeTextarea(draft, 96);
  const mobileTextareaRef = useAutoResizeTextarea(draft, 132, mobileOpen);
  const desktopFileInputRef = useRef<HTMLInputElement>(null);
  const mobileFileInputRef = useRef<HTMLInputElement>(null);
  const mobileImageInputRef = useRef<HTMLInputElement>(null);

  // 승인 대기·거절 글에는 댓글 API가 애초에 쓰기를 막습니다. 입력창을 보여 주고 나서 거절하는
  // 대신 아예 내보내지 않습니다.
  const commentable = capabilities.comment && post.status === "PUBLISHED";
  if (!commentable && !comments.length) return null;

  function appendFiles(incoming: File[]) {
    const result = prepareCommentAttachmentFiles(incoming, files, guestOnly);
    setFiles([...files, ...result.accepted]);
    setAttachmentError(Array.from(new Set(result.rejected)).join(" "));
  }

  function selectFiles(event: ChangeEvent<HTMLInputElement>) {
    appendFiles(Array.from(event.currentTarget.files ?? []));
    event.currentTarget.value = "";
  }

  function removePendingFile(file: File) {
    setFiles((current) => current.filter((candidate) => candidate !== file));
    setAttachmentError("");
  }

  function closeMobileComposer() {
    if (sending) return;
    setCaptureOpen(false);
    setMobileOpen(false);
  }

  async function send(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const body = draft.trim();
    if (!body || sending) return;
    setSending(true);
    setError("");
    try {
      // 손님이면 보내기 직전에 이름을 한 번 묻습니다(글쓰기와 같은 흐름).
      if (!(await guest.ensureName())) return;
      const { comment, commentCount, failedUploads } = await createComment(post.id, body, null, [], files);
      setDraft("");
      setFiles([]);
      setAttachmentError("");
      setCaptureOpen(false);
      setTotal(commentCount);
      // 표시 이름은 서버가 돌려준 값을 씁니다 — 클라이언트에는 복호화된 내 이름이 없습니다.
      setComments((current) => [...current.filter((candidate) => candidate.id !== comment.id), {
        id: comment.id,
        body: comment.body,
        createdAt: comment.createdAt,
        attachments: comment.attachments ?? [],
        author: {
          id: comment.author.id,
          name: comment.author.name,
          image: comment.author.image,
          isGuest: comment.author.isGuest ?? false,
        },
        isMine: true,
      }]);
      if (failedUploads.length) {
        setError(`댓글은 저장됐지만 다음 파일은 올리지 못했습니다: ${failedUploads.join(", ")}`);
      } else {
        setMobileOpen(false);
      }
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "댓글을 저장하지 못했습니다.");
    } finally {
      setSending(false);
    }
  }

  async function remove(comment: CardComment) {
    if (!(await confirm("이 댓글을 삭제할까요? 댓글은 7일 안에 복구할 수 있지만 첨부파일은 즉시 영구 삭제됩니다."))) return;
    setError("");
    try {
      await removeComment(comment.id);
      setComments((current) => current.filter((item) => item.id !== comment.id));
      setTotal((current) => Math.max(0, current - 1));
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "댓글을 삭제하지 못했습니다.");
    }
  }

  // 데스크톱의 빠른 입력만 Enter로 보냅니다. 모바일 시트는 키보드에서 줄바꿈이 더 자연스럽고
  // 아래 전송 버튼이 계속 보이므로 이 핸들러를 연결하지 않습니다.
  function onDraftKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key !== "Enter" || event.shiftKey) return;
    event.preventDefault();
    event.currentTarget.form?.requestSubmit();
  }

  // 한 페이지를 넘긴 드문 경우. 조용히 잘라내지 않고 어디를 보면 되는지 한 줄로 알려 줍니다.
  const hidden = Math.max(0, total - comments.length);

  return (
    <>
      <Isolated className={styles.root}>
        {hidden > 0 && <p className={styles.hidden}>이전 댓글 {hidden}개는 게시물을 열면 볼 수 있어요.</p>}

        {comments.length > 0 && (
          <ul className={styles.list}>
            {comments.map((comment) => {
              // 지울 수 있는 건 자기 댓글과 관리자 권한뿐입니다. 서버가 같은 규칙을 다시 검사합니다.
              // 손님 식별자는 화면에 없으므로 "내 댓글"은 서버가 준 isMine으로 판단합니다.
              const removable = capabilities.moderateComments || (capabilities.editOwnContent && comment.isMine);
              return (
                <li key={comment.id}>
                  <Avatar name={comment.author.name} image={comment.author.image} size="small" />
                  <div className={styles.commentContent}>
                    <p>
                      <b>{comment.author.name || "이름 없는 친구"}</b>
                      {comment.author.isGuest && <span className={styles.guest} title="로그인하지 않고 이름만 남긴 사람이에요.">손님</span>}
                      {renderCommentBody(comment.body, styles.mention, styles.link)}
                      <time dateTime={comment.createdAt}>{formatCommentTime(comment.createdAt)}</time>
                    </p>
                    <CardCommentAttachments attachments={comment.attachments ?? []} />
                  </div>
                  {removable && (
                    <button type="button" className={styles.remove} aria-label="댓글 삭제" onClick={() => remove(comment)}>
                      <Trash2 size={12} />
                    </button>
                  )}
                </li>
              );
            })}
          </ul>
        )}

        {commentable && (
          <>
            <form className={styles.quick} onSubmit={send}>
              <div className={styles.quickRow}>
                <button type="button" className={styles.attachButton} aria-label="댓글에 파일 첨부" title="파일 첨부" disabled={sending} onClick={() => desktopFileInputRef.current?.click()}>
                  <Paperclip size={16} />
                </button>
                <textarea
                  ref={desktopTextareaRef}
                  rows={1}
                  value={draft}
                  onChange={(event) => setDraft(event.target.value)}
                  onKeyDown={onDraftKeyDown}
                  placeholder="댓글 남기기"
                  maxLength={2000}
                  aria-label={`${post.title || "이 게시물"}에 댓글 남기기`}
                />
                <button type="submit" className={styles.sendButton} aria-label="댓글 보내기" title="댓글 보내기" disabled={!draft.trim() || sending}>
                  {sending ? <LoaderCircle size={17} className="spin" /> : <SendHorizontal size={17} />}
                </button>
              </div>
              <PendingCommentFiles files={files} disabled={sending} onRemove={removePendingFile} />
              <input
                ref={desktopFileInputRef}
                className={styles.fileInput}
                type="file"
                accept={guestOnly ? guestCommentAttachmentAccept : commentAttachmentAccept}
                multiple
                disabled={sending}
                onChange={selectFiles}
              />
            </form>

            <button type="button" className={styles.mobileTrigger} onClick={() => setMobileOpen(true)}>
              <MessageCircle size={16} />
              <span>댓글 남기기</span>
            </button>
          </>
        )}

        {(attachmentError || error) && <p className={styles.error} role="alert">{attachmentError || error}</p>}
      </Isolated>

      {commentable && (
        <Modal open={mobileOpen} onClose={closeMobileComposer} title="댓글 남기기" variant="bottom" className={styles.mobileSheet}>
          <form className={styles.mobileSheetForm} onSubmit={send}>
            <div className={styles.mobileEditor}>
              <textarea
                ref={mobileTextareaRef}
                rows={1}
                value={draft}
                onChange={(event) => setDraft(event.target.value)}
                placeholder="생각이나 응원을 남겨보세요."
                maxLength={2000}
                aria-label={`${post.title || "이 게시물"}에 댓글 남기기`}
                autoFocus
              />
              <span>{draft.length.toLocaleString("ko")} / 2,000</span>
            </div>

            <PendingCommentFiles files={files} disabled={sending} onRemove={removePendingFile} />

            {captureOpen && (
              <div className={styles.capturePanel}>
                <CommentMediaCapture
                  modes={["audio"]}
                  onCapture={(file) => { appendFiles([file]); setCaptureOpen(false); }}
                  onClose={() => setCaptureOpen(false)}
                />
              </div>
            )}

            {(attachmentError || error) && <p className={styles.mobileError} role="alert">{attachmentError || error}</p>}

            <footer className={styles.mobileTools}>
              <button type="button" aria-label="파일 첨부" title="파일 첨부" disabled={sending} onClick={() => { setCaptureOpen(false); mobileTextareaRef.current?.blur(); mobileFileInputRef.current?.click(); }}>
                <Paperclip size={19} />
              </button>
              {!guestOnly && (
                <button type="button" data-active={captureOpen} aria-pressed={captureOpen} aria-label="음성 녹음" title="음성 녹음" disabled={sending} onClick={() => { mobileTextareaRef.current?.blur(); setCaptureOpen((current) => !current); }}>
                  <Mic size={19} />
                </button>
              )}
              <button type="button" aria-label="사진 선택" title="사진 선택" disabled={sending} onClick={() => { setCaptureOpen(false); mobileTextareaRef.current?.blur(); mobileImageInputRef.current?.click(); }}>
                <ImageIcon size={19} />
              </button>
              <span className={styles.mobileToolSpacer} />
              <button type="submit" className={styles.mobileSend} aria-label="댓글 보내기" title="댓글 보내기" disabled={!draft.trim() || sending}>
                {sending ? <LoaderCircle size={19} className="spin" /> : <SendHorizontal size={19} />}
              </button>
            </footer>

            <input
              ref={mobileFileInputRef}
              className={styles.fileInput}
              type="file"
              accept={guestOnly ? guestCommentAttachmentAccept : commentAttachmentAccept}
              multiple
              disabled={sending}
              onChange={selectFiles}
            />
            <input
              ref={mobileImageInputRef}
              className={styles.fileInput}
              type="file"
              accept={guestCommentAttachmentAccept}
              multiple
              disabled={sending}
              onChange={selectFiles}
            />
          </form>
        </Modal>
      )}
    </>
  );
}

/**
 * 카드는 그 자체가 드래그 손잡이이자 "글 열기" 버튼입니다. 댓글 영역에서 일어난 입력은
 * 그 둘 어디로도 새면 안 됩니다 — 마우스로 글자를 끌어 선택하면 카드가 따라 움직이고,
 * 모바일에서 입력창을 길게 누르면(터치 센서 250ms) 드래그가 시작되며, 댓글을 읽다 누른
 * 자리가 게시물 열기로 이어집니다. 그래서 포인터 계열 이벤트를 여기서 끊습니다.
 */
function Isolated({ className, children }: { className: string; children: ReactNode }) {
  const stop = (event: { stopPropagation: () => void }) => event.stopPropagation();
  return (
    <div
      className={className}
      onClick={stop}
      onMouseDown={stop}
      onTouchStart={stop}
      onPointerDown={stop}
      onKeyDown={stop}
    >
      {children}
    </div>
  );
}
