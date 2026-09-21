"use client";
/* eslint-disable @next/next/no-img-element */

import { useState } from "react";
import dynamic from "next/dynamic";
import {
  ArrowDown,
  ArrowUp,
  Download,
  ExternalLink,
  FileAudio,
  FileText,
  FileVideo,
  Link2,
  Pencil,
  Play,
  Trash2,
} from "lucide-react";
import { AttachmentMetadataEditor } from "@/components/pad/attachments/attachment-metadata-editor";
import { fileKindLabel, fileKindOf, type FileKind } from "@/components/pad/attachments/file-kind";
import styles from "@/components/pad/attachments/attachment-viewer.module.css";

// pdf.js는 워커까지 합쳐 1MB가 넘습니다. PDF 첨부가 실제로 있는 화면에서만 내려받도록
// 동적으로 부르고, 브라우저 API에 의존하므로 서버 렌더링은 끕니다.
const PdfViewer = dynamic(() => import("@/components/pad/attachments/pdf-viewer").then((mod) => mod.PdfViewer), { ssr: false });

// 한글 뷰어는 WASM만 6.9MB입니다. 한글 첨부가 실제로 있는 화면에서만 내려받습니다.
const HwpViewer = dynamic(() => import("@/components/pad/attachments/hwp-viewer").then((mod) => mod.HwpViewer), { ssr: false });

// 오피스 문서는 서버가 만든 PDF를 PDF 뷰어로 봅니다.
const OfficeViewer = dynamic(() => import("@/components/pad/attachments/office-viewer").then((mod) => mod.OfficeViewer), { ssr: false });
import type {
  AttachmentMetadataInput,
  AttachmentViewData,
} from "@/components/pad/attachments/types";
import { getLinkCardThumbnail, getLinkSourceHost } from "@/lib/link-preview/link-card";

function formatSize(size: number) {
  if (size >= 1024 * 1024) return `${(size / 1024 / 1024).toFixed(1)}MB`;
  return `${Math.max(1, Math.round(size / 1024))}KB`;
}

function attachmentUrl(attachment: AttachmentViewData) {
  return `/f/${encodeURIComponent(attachment.id)}`;
}

function FileCopy({ attachment }: { attachment: AttachmentViewData }) {
  return (
    <span className={styles.copy}>
      <strong>{attachment.originalName}</strong>
      {/* 예전에는 원시 MIME(application/vnd.openxmlformats-…)이 그대로 보였습니다. 사람이 읽을
          이유가 없는 문자열이라 "PPT · 1.2MB"처럼 형식 이름으로 바꿉니다. */}
      <span>{attachment.caption || `${fileKindLabel(attachment)} · ${formatSize(attachment.fileSize)}`}</span>
    </span>
  );
}

// pptx·docx·xlsx만 서버 변환 대상입니다. 압축·텍스트 등은 변환할 것이 없습니다.
const OFFICE_KINDS: readonly FileKind[] = ["SLIDES", "WORD", "SHEET"];

/** 미리보기가 없거나 만들 수 없을 때의 기본 표시. */
function DownloadCard({ attachment, url, canDownload }: { attachment: AttachmentViewData; url: string; canDownload: boolean }) {
  const body = (
    <>
      <span className={styles.fileIcon}><FileText size={19} /></span>
      <FileCopy attachment={attachment} />
      {canDownload && <Download size={17} />}
    </>
  );
  return canDownload
    ? <a className={styles.file} href={`${url}?download=1`}>{body}</a>
    : <div className={styles.file}>{body}</div>;
}

export function AttachmentViewer({
  attachments,
  canDownload = true,
  canEdit = false,
  compact = false,
  movePending = false,
  onDelete,
  onMove,
  onUpdateMetadata,
}: {
  attachments: AttachmentViewData[];
  canDownload?: boolean;
  canEdit?: boolean;
  compact?: boolean;
  movePending?: boolean;
  onDelete?: (attachment: AttachmentViewData) => void;
  onMove?: (attachmentId: string, direction: "up" | "down") => void;
  onUpdateMetadata?: (attachmentId: string, value: AttachmentMetadataInput) => Promise<void>;
}) {
  const [editingId, setEditingId] = useState<string | null>(null);
  return (
    <div className={`${styles.list} ${compact ? styles.compact : ""}`}>
      {attachments.map((attachment, index) => {
        const url = attachmentUrl(attachment);
        // 뷰어를 붙일지는 Attachment.type이 아니라 실제 형식으로 정합니다 — 한글 문서는
        // MIME이 제각각이라 type만 보면 전부 FILE로 떨어집니다.
        const kind = fileKindOf(attachment);
        const isLink = attachment.type === "LINK" && attachment.externalUrl;
        const linkCard = isLink ? getLinkCardThumbnail(attachment.externalUrl, attachment.previewImageUrl) : null;
        const linkHost = isLink ? getLinkSourceHost(attachment.externalUrl) : null;
        return (
          <figure className={styles.item} key={attachment.id}>
            {attachment.type === "IMAGE" && (
              <img
                className={styles.media}
                src={`${url}?variant=thumbnail`}
                alt={attachment.altText || attachment.originalName}
                loading="lazy"
                width={attachment.width ?? undefined}
                height={attachment.height ?? undefined}
                style={attachment.width && attachment.height ? { aspectRatio: `${attachment.width} / ${attachment.height}` } : undefined}
              />
            )}
            {attachment.type === "VIDEO" && (
              <video className={styles.media} controls preload="metadata">
                <source src={url} type={attachment.mimeType} />
                이 브라우저에서는 영상을 재생할 수 없습니다.
              </video>
            )}
            {attachment.type === "AUDIO" && (
              <audio className={styles.audio} controls preload="metadata">
                <source src={url} type={attachment.mimeType} />
                이 브라우저에서는 음성을 재생할 수 없습니다.
              </audio>
            )}
            {kind === "PDF" && !compact && (
              <PdfViewer url={url} title={attachment.originalName} downloadUrl={canDownload ? `${url}?download=1` : undefined} />
            )}
            {kind === "PDF" && compact && <DownloadCard attachment={attachment} url={url} canDownload={canDownload} />}
            {kind === "HWP" && !compact && (
              <HwpViewer url={url} title={attachment.originalName} downloadUrl={canDownload ? `${url}?download=1` : undefined} />
            )}
            {kind === "HWP" && compact && <DownloadCard attachment={attachment} url={url} canDownload={canDownload} />}
            {isLink && linkCard && (
              <a
                className={`${styles.previewLink} ${linkCard.isYouTube ? styles.youtube : ""}`}
                href={attachment.externalUrl!}
                target="_blank"
                rel="noopener noreferrer"
                aria-label={`${linkHost ?? "외부 사이트"}에서 ${attachment.originalName} 보기`}
              >
                <span className={styles.previewThumb}>
                  <img src={linkCard.src} alt="" loading="lazy" referrerPolicy="no-referrer" />
                  {linkCard.isYouTube && <span className={styles.previewPlay} aria-hidden><Play size={24} fill="currentColor" /></span>}
                </span>
                <span className={styles.previewCopy}>
                  {linkHost && <span className={styles.previewEyebrow}>{linkHost} <ExternalLink size={13} aria-hidden /></span>}
                  <strong>{attachment.originalName}</strong>
                  {attachment.caption && <span>{attachment.caption}</span>}
                </span>
              </a>
            )}
            {isLink && !linkCard && (
              <a className={styles.file} href={attachment.externalUrl!} target="_blank" rel="noopener noreferrer">
                <span className={styles.fileIcon}><Link2 size={19} /></span>
                <span className={styles.copy}>
                  <strong>{attachment.originalName}</strong>
                  <span>{attachment.caption || linkHost || "외부 링크"}</span>
                </span>
                <ExternalLink size={17} />
              </a>
            )}
            {!["IMAGE", "VIDEO", "AUDIO", "LINK"].includes(attachment.type) && kind !== "PDF" && kind !== "HWP" && (
              // 오피스 문서는 서버가 PDF로 바꿔 줄 수 있으면 그걸 보여 주고, 변환기가 없으면
              // 아래 내려받기 카드로 되돌아갑니다(fallback으로 그대로 넘깁니다).
              OFFICE_KINDS.includes(kind) && !compact
                ? <OfficeViewer url={url} title={attachment.originalName} downloadUrl={canDownload ? `${url}?download=1` : undefined} fallback={<DownloadCard attachment={attachment} url={url} canDownload={canDownload} />} />
                : <DownloadCard attachment={attachment} url={url} canDownload={canDownload} />
            )}
            {editingId === attachment.id && onUpdateMetadata && (
              <div className={styles.editorShell}>
                <AttachmentMetadataEditor
                  attachment={attachment}
                  onCancel={() => setEditingId(null)}
                  onSave={async (value) => {
                    await onUpdateMetadata(attachment.id, value);
                    setEditingId(null);
                  }}
                />
              </div>
            )}
            <figcaption className={styles.meta}>
              <span className={styles.caption}>
                {attachment.caption || attachment.originalName}
              </span>
              <span className={styles.actions}>
                {attachment.type === "VIDEO" && <FileVideo size={16} aria-hidden />}
                {attachment.type === "AUDIO" && <FileAudio size={16} aria-hidden />}
                {canDownload && attachment.type !== "LINK" && (
                  <a href={`${url}?download=1`} aria-label={`${attachment.originalName} 다운로드`}>
                    <Download size={15} />
                  </a>
                )}
                {canEdit && onUpdateMetadata && (
                  <button
                    type="button"
                    onClick={() => setEditingId((current) => current === attachment.id ? null : attachment.id)}
                    aria-expanded={editingId === attachment.id}
                    aria-label={`${attachment.originalName} 설명 편집`}
                  >
                    <Pencil size={15} />
                  </button>
                )}
                {canEdit && onMove && (
                  <>
                    <button
                      type="button"
                      onClick={() => onMove(attachment.id, "up")}
                      disabled={index === 0 || movePending}
                      aria-label={`${attachment.originalName} 앞 순서로 이동`}
                    >
                      <ArrowUp size={15} />
                    </button>
                    <button
                      type="button"
                      onClick={() => onMove(attachment.id, "down")}
                      disabled={index === attachments.length - 1 || movePending}
                      aria-label={`${attachment.originalName} 뒤 순서로 이동`}
                    >
                      <ArrowDown size={15} />
                    </button>
                  </>
                )}
                {canEdit && onDelete && (
                  <button
                    type="button"
                    onClick={() => onDelete(attachment)}
                    aria-label={`${attachment.originalName} 삭제`}
                  >
                    <Trash2 size={15} />
                  </button>
                )}
              </span>
            </figcaption>
          </figure>
        );
      })}
    </div>
  );
}
