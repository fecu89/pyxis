"use client";
/* eslint-disable @next/next/no-img-element */

import { useEffect, useState } from "react";
import { BetweenVerticalStart, Check, Circle, FileArchive, FileAudio, FileText, Film, Image as ImageIcon, LoaderCircle, Pencil, RotateCcw, Square, Trash2, X } from "lucide-react";
import { classifyAttachmentFile } from "@/components/pad/attachments/file-rules";
import styles from "@/components/pad/attachments/upload-queue-list.module.css";
import type { AttachmentUploadItem } from "@/components/pad/attachments/types";

function formatSize(size: number) {
  if (size >= 1024 * 1024) return `${(size / 1024 / 1024).toFixed(1)}MB`;
  return `${Math.max(1, Math.ceil(size / 1024))}KB`;
}

const statusLabel = {
  queued: "대기",
  uploading: "업로드 중",
  success: "완료",
  error: "실패",
  cancelled: "취소됨",
};

function FileKindIcon({ kind, name }: { kind: ReturnType<typeof classifyAttachmentFile>; name: string }) {
  if (kind === "IMAGE") return <ImageIcon size={16} />;
  if (kind === "AUDIO") return <FileAudio size={16} />;
  if (kind === "VIDEO") return <Film size={16} />;
  if (name.toLowerCase().endsWith(".zip")) return <FileArchive size={16} />;
  return <FileText size={16} />;
}

function useObjectUrl(file: File, enabled: boolean) {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    if (!enabled) return;
    let active = true;
    const next = URL.createObjectURL(file);
    queueMicrotask(() => { if (active) setUrl(next); });
    return () => {
      active = false;
      URL.revokeObjectURL(next);
    };
  }, [enabled, file]);
  return url;
}

type UploadQueueListProps = {
  items: AttachmentUploadItem[];
  onCancel: (id: string) => void;
  onRemove: (id: string) => void | Promise<void>;
  onRetry: (id: string) => void;
  onInsert?: (item: AttachmentUploadItem) => void;
  isInserted?: (item: AttachmentUploadItem) => boolean;
  onEditMetadata?: (item: AttachmentUploadItem) => void;
  editingId?: string | null;
  selectedIds?: ReadonlySet<string>;
  onToggleSelect?: (id: string) => void;
  removingId?: string | null;
  busy?: boolean;
};

function UploadQueueRow({
  item,
  onCancel,
  onRemove,
  onRetry,
  onInsert,
  isInserted,
  onEditMetadata,
  editingId,
  selectedIds,
  onToggleSelect,
  removingId,
  busy = false,
}: Omit<UploadQueueListProps, "items"> & { item: AttachmentUploadItem }) {
  const kind = classifyAttachmentFile(item.file);
  const mediaUrl = useObjectUrl(item.file, kind === "IMAGE" || kind === "AUDIO" || kind === "VIDEO");
  const selected = selectedIds?.has(item.id) ?? false;
  const selectable = item.status !== "uploading";
  const inserted = isInserted?.(item) ?? false;
  return (
    <li className={styles.item} data-selected={selected || undefined}>
      <span className={styles.previewSlot}>
        {kind === "IMAGE" && mediaUrl
          ? <img src={mediaUrl} alt="" />
          : <span className={styles.icon}><FileKindIcon kind={kind} name={item.file.name} /></span>}
        {onToggleSelect && (
          <button
            type="button"
            className={styles.selector}
            data-selected={selected || undefined}
            disabled={!selectable || busy}
            onClick={() => onToggleSelect(item.id)}
            aria-pressed={selected}
            aria-label={`${item.file.name} ${selected ? "선택 해제" : "선택"}`}
            title={selectable ? (selected ? "선택 해제" : "선택") : "업로드 중에는 선택할 수 없습니다"}
          >
            {selected ? <Check size={13} /> : <Circle size={13} />}
          </button>
        )}
      </span>
      <span className={styles.copy}>
        <span className={styles.nameRow}>
          <strong>{item.file.name}</strong>
          <span>{formatSize(item.file.size)} · {statusLabel[item.status]}</span>
        </span>
        {kind === "AUDIO" && mediaUrl && <audio className={styles.mediaPlayer} controls preload="metadata" src={mediaUrl} />}
        {kind === "VIDEO" && mediaUrl && <video className={`${styles.mediaPlayer} ${styles.video}`} controls preload="metadata" src={mediaUrl} />}
        {(item.status === "queued" || item.status === "uploading") && (
          <span
            className={styles.progressTrack}
            role="progressbar"
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={item.progress}
            aria-label={`${item.file.name} 업로드 진행률`}
          >
            <span className={styles.progressBar} style={{ width: `${item.progress}%` }} />
          </span>
        )}
        {item.error && <span className={styles.error}>{item.error}</span>}
      </span>
      <span className={styles.actions}>
        {onInsert && item.status !== "cancelled" && (
          <button type="button" data-active={inserted || undefined} disabled={inserted || busy} onClick={() => onInsert(item)} aria-label={`${item.file.name}을 현재 본문 위치에 배치`} title={inserted ? "본문에 배치됨" : "현재 본문 위치에 배치"}>
            <BetweenVerticalStart size={14} />
          </button>
        )}
        {onEditMetadata && (
          <button type="button" data-active={editingId === item.id || undefined} disabled={busy} onClick={() => onEditMetadata(item)} aria-label={`${item.file.name} 설명 편집`} title="대체텍스트·캡션 편집">
            <Pencil size={14} />
          </button>
        )}
        {item.status === "uploading" && (
          <button type="button" disabled={busy} onClick={() => onCancel(item.id)} aria-label={`${item.file.name} 업로드 취소`} title="업로드 취소"><Square size={13} /></button>
        )}
        {(item.status === "error" || item.status === "cancelled") && (
          <button type="button" disabled={busy} onClick={() => onRetry(item.id)} aria-label={`${item.file.name} 다시 시도`} title="다시 시도"><RotateCcw size={14} /></button>
        )}
        {item.status !== "uploading" && (
          <button
            type="button"
            className={item.attachment ? styles.danger : undefined}
            disabled={removingId === item.id || busy}
            onClick={() => void onRemove(item.id)}
            aria-label={item.attachment ? `${item.file.name} 파일 영구 삭제` : `${item.file.name} 목록에서 제거`}
            title={item.attachment ? "파일 영구 삭제" : "목록에서 제거"}
          >
            {removingId === item.id
              ? <LoaderCircle className={styles.spin} size={14} />
              : item.attachment ? <Trash2 size={14} /> : <X size={14} />}
          </button>
        )}
      </span>
    </li>
  );
}

export function UploadQueueList({
  items,
  onCancel,
  onRemove,
  onRetry,
  onInsert,
  isInserted,
  onEditMetadata,
  editingId,
  selectedIds,
  onToggleSelect,
  removingId,
  busy,
}: UploadQueueListProps) {
  if (!items.length) return null;
  return (
    <ul className={styles.list} aria-label={`첨부 파일 ${items.length}개`}>
      {items.map((item) => (
        <UploadQueueRow key={item.id} item={item} onCancel={onCancel} onRemove={onRemove} onRetry={onRetry} onInsert={onInsert} isInserted={isInserted} onEditMetadata={onEditMetadata} editingId={editingId} selectedIds={selectedIds} onToggleSelect={onToggleSelect} removingId={removingId} busy={busy} />
      ))}
    </ul>
  );
}
