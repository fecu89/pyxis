"use client";

import { useState, type ChangeEvent } from "react";
import { FileAudio, FileText, Image as ImageIcon, Paperclip, Trash2 } from "lucide-react";
import styles from "@/components/pad/comments/threaded-comments.module.css";
import { fileKey } from "@/components/pad/attachments/file-rules";
import {
  commentAttachmentAccept,
  commentAttachmentKind,
  guestCommentAttachmentAccept,
  prepareCommentAttachmentFiles,
} from "@/components/pad/comments/comment-attachment-rules";

function formatSize(size: number) {
  if (size >= 1024 * 1024) return `${(size / 1024 / 1024).toFixed(1)}MB`;
  return `${Math.max(1, Math.ceil(size / 1024))}KB`;
}

export function CommentAttachmentInput({
  files,
  disabled = false,
  guestOnly = false,
  onChange,
}: {
  files: File[];
  disabled?: boolean;
  guestOnly?: boolean;
  onChange: (files: File[]) => void;
}) {
  const [error, setError] = useState("");

  function appendFiles(incoming: File[]) {
    const result = prepareCommentAttachmentFiles(incoming, files, guestOnly);
    onChange([...files, ...result.accepted]);
    setError(Array.from(new Set(result.rejected)).join(" "));
  }

  function selectFiles(event: ChangeEvent<HTMLInputElement>) {
    appendFiles(Array.from(event.target.files ?? []));
    event.currentTarget.value = "";
  }

  function removeFile(target: File) {
    onChange(files.filter((file) => file !== target));
    setError("");
  }

  return (
    <div className={styles.attachmentInput}>
      <div className={styles.attachmentTools}>
        <label className={styles.attachmentButton} aria-disabled={disabled}>
          <Paperclip size={13} /> {guestOnly ? "이미지" : "이미지·음성·PDF"}
          <input
            className={styles.fileInput}
            type="file"
            accept={guestOnly ? guestCommentAttachmentAccept : commentAttachmentAccept}
            multiple
            disabled={disabled}
            onChange={selectFiles}
          />
        </label>
      </div>
      {files.length > 0 && (
        <ul className={styles.pendingAttachments} aria-label={`댓글 첨부 ${files.length}개`}>
          {files.map((file) => (
            <li key={fileKey(file)}>
              {commentAttachmentKind(file) === "IMAGE"
                ? <ImageIcon size={14} />
                : commentAttachmentKind(file) === "AUDIO"
                  ? <FileAudio size={14} />
                  : <FileText size={14} />}
              <span><strong>{file.name}</strong><small>{formatSize(file.size)}</small></span>
              <button type="button" disabled={disabled} onClick={() => removeFile(file)} aria-label={`${file.name} 첨부 제거`}>
                <Trash2 size={13} />
              </button>
            </li>
          ))}
        </ul>
      )}
      {error && <p className={styles.attachmentError} role="alert">{error}</p>}
    </div>
  );
}
