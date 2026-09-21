"use client";

import { useCallback, useEffect, useId, useRef, useState, type ClipboardEvent, type DragEvent, type FormEvent } from "react";
import { BetweenVerticalStart, Camera, Check, Circle, FileAudio, FileText, Film, Image as ImageIcon, Link2, LoaderCircle, Mic, Paperclip, Pencil, SlidersHorizontal, Trash2, Upload, X, XCircle } from "lucide-react";
import { attachmentAccept, attachmentFilesFromClipboard, classifyAttachmentFile, guestAttachmentAccept, guestMaximumAttachmentCount, maximumAttachmentCount, prepareAttachmentFiles, rejectNonImages } from "@/components/pad/attachments/file-rules";
import type { AttachmentMetadataInput, AttachmentUploadItem, AttachmentViewData } from "@/components/pad/attachments/types";
import { useGuestIdentity } from "@/components/pad/guest-identity";
import { cachedUploadPolicy, fetchUploadPolicy } from "@/lib/files/upload-policy-client";
import { MediaCapture } from "@/components/pad/attachments/media-capture";
import { UploadQueueList } from "@/components/pad/attachments/upload-queue-list";
import { useAttachmentUploadQueue } from "@/components/pad/attachments/use-attachment-upload-queue";
import { DraftRecovery } from "@/components/pad/composer/draft-status";
import { ComposerAttachmentMetadata } from "@/components/pad/composer/composer-attachment-metadata";
import { LinkPreviewInput } from "@/components/pad/composer/link-preview-input";
import { MarkdownEditor, type MarkdownEditorHandle } from "@/components/pad/composer/markdown-editor";
import { usePostDraft } from "@/components/pad/composer/use-post-draft";
import {
  hasAttachmentReference,
  pendingAttachmentBlock,
  removeAttachmentBlock,
  removeStoredAttachmentBlock,
  replacePendingAttachmentReferences,
  storedAttachmentBlock,
  stripPendingAttachmentBlocks,
} from "@/components/pad/post-content-blocks";
import { PostCustomFieldsInput } from "@/components/pad/settings/post-custom-fields-input";
import type { PostFieldConfig, PostFieldValues } from "@/components/pad/settings/types";
import { Modal } from "@/components/ui/modal";
import { useConfirm } from "@/components/ui/app-dialog";
import type { PostData } from "@/components/pad/types";
import { requestJson } from "@/lib/api-client";
import type { LinkPreview } from "@/lib/link-preview/types";

type PendingLink = LinkPreview & { clientId: string };
type EditingAttachment = { source: "stored" | "queue"; id: string } | null;

function initialCustomValues(post?: PostData): PostFieldValues {
  if (!post?.customFieldValues) return {};
  return Object.fromEntries(Object.entries(post.customFieldValues.fields).map(([id, stored]) => [id, stored.value]));
}

function linkHostname(url: string) {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
}

function formatAttachmentSize(size: number) {
  if (size >= 1024 * 1024) return `${(size / 1024 / 1024).toFixed(1)}MB`;
  return `${Math.max(1, Math.ceil(size / 1024))}KB`;
}

function attachmentTypeLabel(type: AttachmentViewData["type"]) {
  if (type === "IMAGE") return "이미지";
  if (type === "AUDIO") return "음성";
  if (type === "VIDEO") return "영상";
  if (type === "LINK") return "링크";
  if (type === "PDF") return "PDF";
  if (type === "DOCUMENT") return "문서";
  return "파일";
}

function AttachmentKindIcon({ type }: { type: AttachmentViewData["type"] }) {
  if (type === "IMAGE") return <ImageIcon size={15} />;
  if (type === "AUDIO") return <FileAudio size={15} />;
  if (type === "VIDEO") return <Film size={15} />;
  if (type === "LINK") return <Link2 size={15} />;
  return <FileText size={15} />;
}

function uploadItemType(item: AttachmentUploadItem): AttachmentViewData["type"] {
  if (item.attachment) return item.attachment.type;
  const kind = classifyAttachmentFile(item.file);
  if (kind === "IMAGE" || kind === "AUDIO" || kind === "VIDEO" || kind === "PDF") return kind;
  if (kind === "DOCUMENT" || kind === "HWP") return "DOCUMENT";
  return "FILE";
}

export type PostComposerProps = {
  open: boolean;
  onClose: () => void;
  sectionId: string;
  sectionTitle: string;
  fieldConfig: PostFieldConfig;
  post?: PostData;
  onSaved?: (post: PostData) => void;
  presentation?: "modal" | "inline";
};

export function PostComposer({ open, onClose, sectionId, sectionTitle, fieldConfig, post, onSaved, presentation = "modal" }: PostComposerProps) {
  const formId = useId();
  const confirm = useConfirm();
  // 손님은 사진만, 5개까지입니다. 서버가 같은 제한을 다시 거니 여기서 막는 건 안내용입니다.
  const guest = useGuestIdentity();
  const guestOnly = guest.guestWriteOpen;
  const queue = useAttachmentUploadQueue({ concurrency: 3 });
  const draft = usePostDraft({
    scope: post ? `post:${post.id}` : `section:${sectionId}:new`,
    initialTitle: post?.title ?? "",
    initialBody: post?.body ?? "",
    enabled: open,
  });
  const [customValues, setCustomValues] = useState<PostFieldValues>(() => initialCustomValues(post));
  const [links, setLinks] = useState<PendingLink[]>([]);
  const [captureOpen, setCaptureOpen] = useState(false);
  const [linkOpen, setLinkOpen] = useState(false);
  const [moreToolsOpen, setMoreToolsOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [error, setError] = useState("");
  const [fileError, setFileError] = useState("");
  const [savedTarget, setSavedTarget] = useState<{ id: string; version: number } | null>(null);
  const [removedAttachmentIds, setRemovedAttachmentIds] = useState<Set<string>>(() => new Set());
  const [removingAttachmentId, setRemovingAttachmentId] = useState<string | null>(null);
  const [bulkRemoving, setBulkRemoving] = useState(false);
  const [selectedAttachments, setSelectedAttachments] = useState<Set<string>>(() => new Set());
  const [editingAttachment, setEditingAttachment] = useState<EditingAttachment>(null);
  const [queueMetadata, setQueueMetadata] = useState<Record<string, AttachmentMetadataInput>>({});
  const [storedMetadata, setStoredMetadata] = useState<Record<string, AttachmentMetadataInput>>({});
  const fileInputRef = useRef<HTMLInputElement>(null);
  const markdownEditorRef = useRef<MarkdownEditorHandle>(null);
  const existingAttachments = post?.attachments
    .filter((attachment) => !removedAttachmentIds.has(attachment.id))
    .map((attachment) => ({ ...attachment, ...storedMetadata[attachment.id] })) ?? [];

  const closeComposer = useCallback(() => {
    queue.reset();
    setLinks([]);
    setCaptureOpen(false);
    setLinkOpen(false);
    setMoreToolsOpen(false);
    setError("");
    setFileError("");
    setDragging(false);
    setSavedTarget(null);
    setRemovingAttachmentId(null);
    setBulkRemoving(false);
    setSelectedAttachments(new Set());
    setEditingAttachment(null);
    setQueueMetadata({});
    setCustomValues(initialCustomValues(post));
    onClose();
  }, [onClose, post, queue]);

  async function requestCloseComposer() {
    if (submitting || queue.isUploading) return;
    if (savedTarget) {
      const unresolved = queue.items.filter((item) => item.status !== "success").length + links.length;
      const confirmed = await confirm({
        title: "저장된 게시물 닫기",
        description: unresolved
          ? `본문과 성공한 첨부는 이미 저장되었습니다. 대기·실패한 첨부 ${unresolved}개는 창을 닫으면 다시 선택해야 합니다. 그래도 닫을까요?`
          : "게시물의 일부 단계가 이미 서버에 저장되었습니다. 창을 닫아도 저장된 내용은 패드에 남습니다.",
        confirmLabel: "닫기",
      });
      if (!confirmed) return;
    }
    closeComposer();
  }

  // 업로드 상한은 관리 페이지에서 바뀔 수 있어 화면이 서버에서 받아 옵니다. 탭당 한 번이면
  // 충분하고, 못 받아도 기본값으로 안내한 뒤 서버가 최종 판정을 합니다.
  useEffect(() => {
    void fetchUploadPolicy();
  }, []);

  function addFiles(incoming: File[]) {
    // 손님이면 사진이 아닌 것을 먼저 잘라 내고, 남은 것만 공통 규칙에 넣습니다.
    const filtered = guestOnly ? rejectNonImages(incoming) : { accepted: incoming, rejected: [] as string[] };
    const policy = cachedUploadPolicy();
    // 손님은 더 좁은 상한을 받습니다(서버도 같은 값을 씁니다). 화면에서 미리 걸러 줘야
    // 큰 파일을 다 올린 뒤에 거절당하는 헛걸음이 없습니다.
    const effectivePolicy = guestOnly
      ? {
          ...policy,
          maxUploadMb: Math.min(policy.guestMaxUploadMb, policy.maxUploadMb),
          maxImageUploadMb: Math.min(policy.maxImageUploadMb, policy.guestMaxUploadMb, policy.maxUploadMb),
        }
      : policy;
    const prepared = prepareAttachmentFiles(
      filtered.accepted,
      queue.items.filter((item) => item.status !== "cancelled").map((item) => item.file),
      guestOnly ? guestMaximumAttachmentCount : maximumAttachmentCount,
      effectivePolicy,
      existingAttachments.length + links.length,
    );
    if (prepared.accepted.length) {
      const ids = queue.addFiles(prepared.accepted);
      if (fieldConfig.body.visible) {
        for (let index = 0; index < ids.length; index += 1) {
          const file = prepared.accepted[index];
          markdownEditorRef.current?.insertBlock(pendingAttachmentBlock(
            { kind: "upload", id: ids[index] },
            file.name,
            classifyAttachmentFile(file) === "IMAGE" ? "IMAGE" : "PENDING",
          ));
        }
      }
    }
    setFileError([...filtered.rejected, ...prepared.rejected].join(" "));
  }

  function handlePaste(event: ClipboardEvent<HTMLFormElement>) {
    if (!fieldConfig.attachment.visible) return;
    const pasted = attachmentFilesFromClipboard(event.clipboardData);
    if (!pasted.length) return;
    event.preventDefault();
    addFiles(pasted);
  }

  function handleDrop(event: DragEvent<HTMLElement>) {
    event.preventDefault();
    setDragging(false);
    addFiles(Array.from(event.dataTransfer.files));
  }

  function openFilePicker(accept = guestOnly ? guestAttachmentAccept : attachmentAccept) {
    const input = fileInputRef.current;
    if (!input) return;
    input.accept = accept;
    input.click();
  }

  function toggleCapture() {
    setCaptureOpen((current) => !current);
    setLinkOpen(false);
    setMoreToolsOpen(false);
  }

  function toggleLinks() {
    setLinkOpen((current) => !current);
    setCaptureOpen(false);
    setMoreToolsOpen(false);
  }

  function toggleMoreTools() {
    setMoreToolsOpen((current) => !current);
    setCaptureOpen(false);
    setLinkOpen(false);
  }

  function closeToolPanels() {
    setCaptureOpen(false);
    setLinkOpen(false);
    setMoreToolsOpen(false);
  }

  function addLinks(previews: LinkPreview[]) {
    setLinks((current) => {
      const urls = new Set(current.map((item) => item.url));
      return [...current, ...previews.filter((preview) => {
        if (urls.has(preview.url)) return false;
        urls.add(preview.url);
        return true;
      }).map((preview) => ({ ...preview, clientId: crypto.randomUUID() }))];
    });
  }

  async function saveLink(postId: string, preview: LinkPreview) {
    const response = await fetch(`/api/posts/${postId}/links`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        url: preview.url,
        title: preview.title,
        description: preview.description ?? "",
        previewImageUrl: preview.image,
      }),
    });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || "링크를 첨부하지 못했습니다.");
    return result;
  }

  function insertQueuedAttachment(item: AttachmentUploadItem) {
    const markdown = item.attachment
      ? storedAttachmentBlock(item.attachment)
      : pendingAttachmentBlock(
          { kind: "upload", id: item.id },
          item.file.name,
          classifyAttachmentFile(item.file) === "IMAGE" ? "IMAGE" : "PENDING",
        );
    markdownEditorRef.current?.insertBlock(markdown);
  }

  function queuedAttachmentInserted(item: AttachmentUploadItem) {
    return item.attachment
      ? hasAttachmentReference(draft.value.body, "attachment", item.attachment.id)
      : hasAttachmentReference(draft.value.body, "upload", item.id);
  }

  function toggleAttachmentSelection(source: "stored" | "queue", id: string) {
    const key = `${source}:${id}`;
    setSelectedAttachments((current) => {
      const next = new Set(current);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  function removeQueueEntries(items: AttachmentUploadItem[]) {
    if (!items.length) return;
    const ids = new Set(items.map((item) => item.id));
    queue.removeMany(ids);
    draft.setValue((current) => {
      let body = current.body;
      for (const item of items) {
        body = removeAttachmentBlock(body, { kind: "upload", id: item.id });
        if (item.attachment) body = removeStoredAttachmentBlock(body, item.attachment.id);
      }
      return { ...current, body };
    });
    setQueueMetadata((current) => Object.fromEntries(Object.entries(current).filter(([id]) => !ids.has(id))));
    setSelectedAttachments((current) => new Set([...current].filter((key) => !key.startsWith("queue:") || !ids.has(key.slice(6)))));
    setEditingAttachment((current) => current?.source === "queue" && ids.has(current.id) ? null : current);
  }

  function clearFailedQueueItems() {
    removeQueueEntries(queue.items.filter((item) => item.status === "error" || item.status === "cancelled"));
  }

  async function removeSelectedAttachments() {
    if (!selectedAttachments.size || bulkRemoving || queue.isUploading) return;
    const selectedStoredIds = new Set([...selectedAttachments].filter((key) => key.startsWith("stored:")).map((key) => key.slice(7)));
    const selectedQueueIds = new Set([...selectedAttachments].filter((key) => key.startsWith("queue:")).map((key) => key.slice(6)));
    const storedTargets = existingAttachments.filter((attachment) => selectedStoredIds.has(attachment.id));
    const queueTargets = queue.items.filter((item) => selectedQueueIds.has(item.id));
    const serverTargets = [
      ...storedTargets.map((attachment) => ({ attachmentId: attachment.id, name: attachment.originalName, source: "stored" as const, sourceId: attachment.id })),
      ...queueTargets.flatMap((item) => item.attachment ? [{ attachmentId: item.attachment.id, name: item.file.name, source: "queue" as const, sourceId: item.id }] : []),
    ];
    const total = storedTargets.length + queueTargets.length;
    if (!total) return setSelectedAttachments(new Set());
    const confirmed = await confirm({
      title: `첨부 ${total}개 삭제`,
      description: serverTargets.length
        ? `선택한 항목 중 서버에 저장된 ${serverTargets.length}개 파일은 즉시 영구 삭제되며 복구할 수 없습니다.`
        : "선택한 업로드 대기 항목을 목록과 본문에서 제거할까요?",
      confirmLabel: "삭제",
      danger: serverTargets.length > 0,
    });
    if (!confirmed) return;
    setBulkRemoving(true);
    setFileError("");
    const results = await Promise.allSettled(serverTargets.map((target) => requestJson(`/api/attachments/${encodeURIComponent(target.attachmentId)}`, { method: "DELETE" })));
    const deletedServerKeys = new Set<string>();
    let failed = 0;
    results.forEach((result, index) => {
      const target = serverTargets[index];
      if (result.status === "fulfilled") deletedServerKeys.add(`${target.source}:${target.sourceId}`);
      else failed += 1;
    });
    const removedStored = storedTargets.filter((attachment) => deletedServerKeys.has(`stored:${attachment.id}`));
    const removedQueue = queueTargets.filter((item) => !item.attachment || deletedServerKeys.has(`queue:${item.id}`));
    if (removedStored.length) {
      const ids = new Set(removedStored.map((attachment) => attachment.id));
      setRemovedAttachmentIds((current) => new Set([...current, ...ids]));
      draft.setValue((current) => {
        let body = current.body;
        for (const id of ids) body = removeStoredAttachmentBlock(body, id);
        return { ...current, body };
      });
    }
    removeQueueEntries(removedQueue);
    const removedKeys = new Set([
      ...removedStored.map((attachment) => `stored:${attachment.id}`),
      ...removedQueue.map((item) => `queue:${item.id}`),
    ]);
    setSelectedAttachments((current) => new Set([...current].filter((key) => !removedKeys.has(key))));
    if (failed) setFileError(`${failed}개 첨부를 삭제하지 못했습니다. 선택된 항목을 다시 확인해 주세요.`);
    setBulkRemoving(false);
  }

  async function saveStoredMetadata(attachment: AttachmentViewData, value: AttachmentMetadataInput) {
    const result = await requestJson<{ attachment: Partial<AttachmentViewData> }>(`/api/attachments/${encodeURIComponent(attachment.id)}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(value),
    });
    setStoredMetadata((current) => ({
      ...current,
      [attachment.id]: {
        altText: result.attachment.altText !== undefined ? result.attachment.altText ?? null : value.altText,
        caption: result.attachment.caption !== undefined ? result.attachment.caption ?? null : value.caption,
      },
    }));
    setEditingAttachment(null);
  }

  async function saveQueueMetadata(item: AttachmentUploadItem, value: AttachmentMetadataInput) {
    if (item.attachment) {
      await requestJson(`/api/attachments/${encodeURIComponent(item.attachment.id)}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(value),
      });
    }
    setQueueMetadata((current) => ({ ...current, [item.id]: value }));
    setEditingAttachment(null);
  }

  async function deleteStoredAttachment(attachmentId: string, name: string, actionId = attachmentId) {
    if (removingAttachmentId) return false;
    const confirmed = await confirm({
      title: "첨부파일 삭제",
      description: `'${name}'을 영구 삭제할까요? 편집을 취소해도 파일은 복구되지 않습니다.`,
      confirmLabel: "삭제",
      danger: true,
    });
    if (!confirmed) return false;
    setRemovingAttachmentId(actionId);
    setFileError("");
    try {
      await requestJson(`/api/attachments/${encodeURIComponent(attachmentId)}`, { method: "DELETE" });
      return true;
    } catch (reason) {
      setFileError(reason instanceof Error ? reason.message : "첨부파일을 삭제하지 못했습니다.");
      return false;
    } finally {
      setRemovingAttachmentId(null);
    }
  }

  async function removeExistingAttachment(attachment: AttachmentViewData) {
    if (!(await deleteStoredAttachment(attachment.id, attachment.originalName))) return;
    setRemovedAttachmentIds((current) => new Set(current).add(attachment.id));
    setSelectedAttachments((current) => new Set([...current].filter((key) => key !== `stored:${attachment.id}`)));
    setEditingAttachment((current) => current?.source === "stored" && current.id === attachment.id ? null : current);
    draft.setValue((current) => ({
      ...current,
      body: removeStoredAttachmentBlock(current.body, attachment.id),
    }));
  }

  async function removeQueuedAttachment(id: string) {
    const item = queue.items.find((entry) => entry.id === id);
    if (!item) return;
    if (item.attachment && !(await deleteStoredAttachment(item.attachment.id, item.file.name, item.id))) return;
    removeQueueEntries([item]);
  }

  function insertPendingLink(link: PendingLink) {
    markdownEditorRef.current?.insertBlock(pendingAttachmentBlock({ kind: "link", id: link.clientId }, link.title, "LINK"));
  }

  function removePendingLink(link: PendingLink) {
    setLinks((current) => current.filter((item) => item.clientId !== link.clientId));
    draft.setValue((current) => ({
      ...current,
      body: removeAttachmentBlock(current.body, { kind: "link", id: link.clientId }),
    }));
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const formData = new FormData(event.currentTarget);
    const submittedBody = markdownEditorRef.current?.getMarkdown() ?? draft.value.body;
    if (fieldConfig.body.visible && fieldConfig.body.required && !submittedBody.trim()) {
      setError("내용을 입력해 주세요.");
      return;
    }
    if (submittedBody.length > 20_000) {
      setError("내용은 20,000자 이하로 입력해 주세요.");
      return;
    }
    const attachmentLimit = guestOnly ? guestMaximumAttachmentCount : maximumAttachmentCount;
    const pendingAttachmentCount = existingAttachments.length;
    const totalPlannedAttachments = pendingAttachmentCount + queue.items.filter((item) => item.status !== "cancelled").length + links.length;
    if (totalPlannedAttachments > attachmentLimit) {
      setError(`게시물에는 파일과 링크를 합쳐 최대 ${attachmentLimit}개까지 첨부할 수 있습니다.`);
      return;
    }
    if (fieldConfig.attachment.visible && fieldConfig.attachment.required && totalPlannedAttachments < 1) {
      setError("첨부 파일 또는 링크를 하나 이상 추가해 주세요.");
      return;
    }
    setSubmitting(true);
    setError("");
    try {
      const target = savedTarget ?? (post ? { id: post.id, version: post.version } : null);
      const response = await fetch(target ? `/api/posts/${target.id}` : `/api/sections/${sectionId}/posts`, {
        method: target ? "PATCH" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: draft.value.title,
          body: submittedBody,
          fieldConfigVersion: fieldConfig.version,
          customFieldValues: customValues,
          ...(target ? { version: target.version, ...(!guestOnly ? { isPinned: formData.get("isPinned") === "on" } : {}) } : {}),
        }),
      });
      const saved = await response.json();
      if (!response.ok) throw new Error(saved.error || "글을 저장하지 못했습니다.");
      const postId = target?.id ?? saved.post.id;
      let version = saved.post.version as number;
      setSavedTarget({ id: postId, version });

      const uploadResult = await queue.start(postId);
      const replacements = new Map<string, string>();
      for (const item of uploadResult.successful) replacements.set(`upload:${item.id}`, item.attachment.id);
      const uploadedAttachments = new Map<string, AttachmentViewData>([
        ...queue.items.flatMap((item) => item.attachment ? [[item.id, item.attachment] as const] : []),
        ...uploadResult.successful.map((item) => [item.id, item.attachment] as const),
      ]);
      for (const [queueId, metadata] of Object.entries(queueMetadata)) {
        const attachment = uploadedAttachments.get(queueId);
        if (!attachment) continue;
        await requestJson(`/api/attachments/${encodeURIComponent(attachment.id)}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(metadata),
        });
      }
      const failedLinks: PendingLink[] = [];
      let savedLinkCount = 0;
      for (const preview of links) {
        try {
          const result = await saveLink(postId, preview) as { attachment?: { id?: string } };
          if (!result.attachment?.id) throw new Error("저장된 링크 ID가 없습니다.");
          replacements.set(`link:${preview.clientId}`, result.attachment.id);
          savedLinkCount += 1;
        } catch {
          failedLinks.push(preview);
        }
      }
      setLinks(failedLinks);
      const failedNames = uploadResult.failed.map((item) => item.file.name);
      const resolvedBody = replacePendingAttachmentReferences(submittedBody, replacements);
      const publishedBody = stripPendingAttachmentBlocks(resolvedBody);
      if (resolvedBody !== submittedBody) {
        draft.setValue((current) => ({ ...current, body: resolvedBody }));
      }

      const finalizedCount = pendingAttachmentCount + uploadResult.successful.length + queue.items.filter((item) => item.status === "success").length + savedLinkCount;
      const finalResponse = await fetch(`/api/posts/${postId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ version, attachmentCount: finalizedCount, body: publishedBody }),
      });
      const finalized = await finalResponse.json();
      if (!finalResponse.ok) throw new Error(finalized.error || "첨부 필수 조건을 확인하지 못했습니다.");
      version = finalized.post.version;
      setSavedTarget({ id: postId, version });
      if (failedNames.length || failedLinks.length) {
        throw new Error(`글은 저장됐지만 일부 첨부에 실패했습니다. 아래 항목을 재시도해 주세요.${failedNames.length ? ` 파일: ${failedNames.join(", ")}` : ""}${failedLinks.length ? ` 링크: ${failedLinks.map((item) => item.title).join(", ")}` : ""}`);
      }
      draft.markSaved();
      if (onSaved && finalized.post && Array.isArray(finalized.post.attachments)) {
        onSaved(finalized.post as PostData);
      }
      closeComposer();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "글을 저장하지 못했습니다.");
    } finally {
      setSubmitting(false);
    }
  }

  const attachmentLimit = guestOnly ? guestMaximumAttachmentCount : maximumAttachmentCount;
  const queuedFileCount = queue.items.filter((item) => item.status !== "cancelled").length;
  const plannedAttachmentCount = existingAttachments.length + queuedFileCount + links.length;
  const remainingAttachmentSlots = Math.max(0, attachmentLimit - plannedAttachmentCount);
  const remainingLinkSlots = remainingAttachmentSlots;
  const selectedQueueIds = new Set([...selectedAttachments].filter((key) => key.startsWith("queue:")).map((key) => key.slice(6)));
  const failedQueueCount = queue.items.filter((item) => item.status === "error" || item.status === "cancelled").length;
  const editingStoredAttachment = editingAttachment?.source === "stored" ? existingAttachments.find((item) => item.id === editingAttachment.id) : undefined;
  const editingQueueItem = editingAttachment?.source === "queue" ? queue.items.find((item) => item.id === editingAttachment.id) : undefined;
  const selectedLinkUrls = [
    ...existingAttachments.flatMap((attachment) => attachment.type === "LINK" && attachment.externalUrl ? [attachment.externalUrl] : []),
    ...links.map((link) => link.url),
  ];
  const submitLabel = submitting ? (post ? "수정 중" : "게시 중") : savedTarget ? "다시 게시하기" : post ? "수정하기" : "게시하기";

  const composerForm = (
    <form id={formId} className="composer-form" onSubmit={submit} onPaste={handlePaste}>
        <div className="composer-editor-scroll" onPointerDown={closeToolPanels} onFocusCapture={closeToolPanels}>
          {draft.availableDraft && <DraftRecovery savedAt={draft.availableDraft.savedAt} onRestore={draft.restoreDraft} onDiscard={draft.discardDraft} />}
          {savedTarget && <div className="composer-partial-save-notice" role="status"><Check size={15} /><span><b>본문은 저장되었습니다.</b><small>실패한 첨부를 재시도한 뒤 다시 게시해 주세요.</small></span></div>}
          {fieldConfig.title.visible && <label className="composer-title-field">제목 {fieldConfig.title.required ? <span>필수</span> : <span>선택</span>}<input value={draft.value.title} onChange={(event) => draft.setValue((current) => ({ ...current, title: event.target.value }))} placeholder={fieldConfig.title.placeholder} maxLength={200} required={fieldConfig.title.required} autoFocus /></label>}
          {fieldConfig.body.visible && (
            <div className="composer-body-field">
              <span className="composer-field-label">내용</span>
              <MarkdownEditor
                ref={markdownEditorRef}
                value={draft.value.body}
                onChange={(body) => draft.setValue((current) => ({ ...current, body }))}
                onFilesDrop={fieldConfig.attachment.visible ? addFiles : undefined}
                placeholder={fieldConfig.body.placeholder}
                required={fieldConfig.body.required}
              />
            </div>
          )}
          <PostCustomFieldsInput config={fieldConfig} values={customValues} onChange={setCustomValues} />
          {post && !guestOnly && <label className="check-label"><input type="checkbox" name="isPinned" defaultChecked={post.isPinned} /> 섹션 위에 고정하기</label>}
          {fieldConfig.attachment.visible && <>
            <section className="composer-attachment-summary" aria-label="첨부 현황">
              <span><Paperclip size={16} /><b>첨부 {plannedAttachmentCount}개</b><small>{remainingAttachmentSlots > 0 ? `${remainingAttachmentSlots}개 추가 가능` : "추가 한도에 도달함"}</small></span>
              {selectedAttachments.size > 0 && <button type="button" className="button danger" disabled={bulkRemoving || queue.isUploading} onClick={() => void removeSelectedAttachments()}>{bulkRemoving ? <LoaderCircle className="spin" size={14} /> : <Trash2 size={14} />}{selectedAttachments.size}개 삭제</button>}
            </section>
            {existingAttachments.length ? (
              <section className="composer-attachment-placement composer-stored-attachments">
                <header><b>저장된 첨부</b><small>{existingAttachments.length}개</small></header>
                <ul aria-label={`저장된 첨부 ${existingAttachments.length}개`}>
                  {existingAttachments.map((attachment) => {
                    const inserted = hasAttachmentReference(draft.value.body, "attachment", attachment.id);
                    const selected = selectedAttachments.has(`stored:${attachment.id}`);
                    return (
                      <li key={attachment.id} data-selected={selected || undefined}>
                        <button type="button" className="composer-select-attachment" data-selected={selected || undefined} disabled={bulkRemoving} onClick={() => toggleAttachmentSelection("stored", attachment.id)} aria-pressed={selected} aria-label={`${attachment.originalName} ${selected ? "선택 해제" : "선택"}`} title={selected ? "선택 해제" : "선택"}>{selected ? <Check size={13} /> : <Circle size={13} />}</button>
                        <AttachmentKindIcon type={attachment.type} />
                        <span className="composer-attachment-copy" title={attachment.originalName}>
                          <b>{attachment.originalName}</b>
                          <small>{attachmentTypeLabel(attachment.type)}{attachment.type !== "LINK" ? ` · ${formatAttachmentSize(attachment.fileSize)}` : ""}</small>
                        </span>
                        <button type="button" className="composer-insert-attachment" data-active={inserted || undefined} disabled={inserted || bulkRemoving} onClick={() => markdownEditorRef.current?.insertBlock(storedAttachmentBlock(attachment))} aria-label={`${attachment.originalName}을 현재 본문 위치에 배치`} title={inserted ? "본문에 배치됨" : "현재 본문 위치에 배치"}><BetweenVerticalStart size={14} /></button>
                        <button type="button" data-active={editingAttachment?.source === "stored" && editingAttachment.id === attachment.id || undefined} disabled={bulkRemoving} onClick={() => setEditingAttachment((current) => current?.source === "stored" && current.id === attachment.id ? null : { source: "stored", id: attachment.id })} aria-label={`${attachment.originalName} 설명 편집`} title="대체텍스트·캡션 편집"><Pencil size={14} /></button>
                        <button type="button" className="composer-delete-attachment" disabled={removingAttachmentId !== null || bulkRemoving} onClick={() => void removeExistingAttachment(attachment)} aria-label={`${attachment.originalName} 영구 삭제`} title="영구 삭제">{removingAttachmentId === attachment.id ? <LoaderCircle className="spin" size={14} /> : <Trash2 size={14} />}</button>
                      </li>
                    );
                  })}
                </ul>
                {editingStoredAttachment && <ComposerAttachmentMetadata key={`stored:${editingStoredAttachment.id}`} name={editingStoredAttachment.originalName} type={editingStoredAttachment.type} value={{ altText: editingStoredAttachment.altText ?? null, caption: editingStoredAttachment.caption ?? null }} onCancel={() => setEditingAttachment(null)} onSave={(value) => saveStoredMetadata(editingStoredAttachment, value)} />}
              </section>
            ) : null}
            {queue.items.length > 0 && (
              <section className="composer-attachment-placement composer-new-attachments">
                <header><b>새 첨부</b><span>{failedQueueCount > 0 && <button type="button" onClick={clearFailedQueueItems} aria-label={`실패·취소 ${failedQueueCount}개 정리`} title="실패·취소 항목 정리"><XCircle size={14} /></button>}<small>{queue.items.length}개</small></span></header>
                <UploadQueueList items={queue.items} onCancel={queue.cancel} onRemove={removeQueuedAttachment} onRetry={(id) => { const targetId = savedTarget?.id ?? post?.id; if (targetId) void queue.retry(targetId, id); }} onInsert={insertQueuedAttachment} isInserted={queuedAttachmentInserted} onEditMetadata={(item) => setEditingAttachment((current) => current?.source === "queue" && current.id === item.id ? null : { source: "queue", id: item.id })} editingId={editingAttachment?.source === "queue" ? editingAttachment.id : null} selectedIds={selectedQueueIds} onToggleSelect={(id) => toggleAttachmentSelection("queue", id)} removingId={removingAttachmentId} busy={bulkRemoving} />
                {editingQueueItem && <ComposerAttachmentMetadata key={`queue:${editingQueueItem.id}`} name={editingQueueItem.file.name} type={uploadItemType(editingQueueItem)} value={queueMetadata[editingQueueItem.id] ?? { altText: editingQueueItem.attachment?.altText ?? null, caption: editingQueueItem.attachment?.caption ?? null }} onCancel={() => setEditingAttachment(null)} onSave={(value) => saveQueueMetadata(editingQueueItem, value)} />}
              </section>
            )}
            {links.length > 0 && (
              <section className="composer-links composer-selected-links"><header><span><Link2 size={15} /><b>추가할 링크</b></span><small>{links.length}개</small></header><ul aria-label="추가할 링크">{links.map((link) => { const inserted = hasAttachmentReference(draft.value.body, "link", link.clientId); return <li key={link.clientId}><span className="composer-link-icon"><Link2 size={14} /></span><span className="composer-link-copy"><b>{link.title}</b><small>{link.siteName || linkHostname(link.url)}</small></span><button type="button" className="composer-insert-attachment" data-active={inserted || undefined} disabled={inserted} onClick={() => insertPendingLink(link)} aria-label={`${link.title}을 현재 본문 위치에 배치`} title={inserted ? "본문에 배치됨" : "현재 본문 위치에 배치"}><BetweenVerticalStart size={13} /></button><button type="button" onClick={() => removePendingLink(link)} aria-label={`${link.title} 링크 제거`}><X size={13} /></button></li>; })}</ul></section>
            )}
          </>}
          {fileError && <p className="form-error" role="alert">{fileError}</p>}
          {error && <p className="form-error" role="alert">{error}</p>}
        </div>

        {fieldConfig.attachment.visible && (captureOpen || linkOpen || moreToolsOpen) && <section className="composer-tool-panel" aria-label="첨부 도구 옵션">
          {captureOpen && <MediaCapture onCapture={(file) => addFiles([file])} onClose={() => setCaptureOpen(false)} />}
          {linkOpen && <section className="composer-links"><header><span><Link2 size={15} /><b>링크 첨부</b></span><small>{links.length ? `${links.length}개 추가 대기` : "여러 개를 한 번에"}</small></header><LinkPreviewInput selectedUrls={selectedLinkUrls} remainingSlots={remainingLinkSlots} onSelect={addLinks} /></section>}
          {moreToolsOpen && <div className="composer-more-tools"><button type="button" onClick={() => openFilePicker(".mp3,.m4a,.wav,.ogg")}><Mic size={20} /><span><b>음성 파일</b><small>MP3, M4A, WAV, OGG</small></span></button><button type="button" onClick={() => openFilePicker(".mp4,.webm,.mov")}><Film size={20} /><span><b>영상 파일</b><small>MP4, WebM, MOV</small></span></button><button type="button" onClick={() => openFilePicker(".pdf,.docx,.pptx,.xlsx,.txt,.zip,.hwp,.hwpx")}><FileText size={20} /><span><b>문서 파일</b><small>PDF, Office, HWP, ZIP</small></span></button><div className={`composer-drop-target ${dragging ? "dragging" : ""}`} onDragEnter={(event) => { event.preventDefault(); setDragging(true); }} onDragOver={(event) => { event.preventDefault(); event.dataTransfer.dropEffect = "copy"; }} onDragLeave={(event) => { if (!(event.relatedTarget instanceof Node) || !event.currentTarget.contains(event.relatedTarget)) setDragging(false); }} onDrop={handleDrop}><Paperclip size={18} /><span><b>{dragging ? "여기에 놓으세요" : "파일 끌어놓기"}</b><small>첨부 파일은 최대 30MB</small></span></div></div>}
        </section>}

        {fieldConfig.attachment.visible && <input ref={fileInputRef} type="file" multiple accept={guestOnly ? guestAttachmentAccept : attachmentAccept} className="composer-hidden-file" onChange={(event) => { addFiles(Array.from(event.target.files ?? [])); event.currentTarget.value = ""; }} />}
        <div className="composer-bottom">
          {fieldConfig.attachment.visible && (guestOnly
            // 손님에게는 사진과 촬영만 남깁니다. 문서·영상·링크는 계정이 있는 사람만 올릴 수 있어요.
            ? <div className="composer-tool-dock" role="toolbar" aria-label="게시물 첨부 도구"><button type="button" onClick={() => openFilePicker()}><ImageIcon size={21} /><span>사진</span></button><button type="button" data-active={captureOpen} aria-pressed={captureOpen} onClick={toggleCapture}><Camera size={21} /><span>촬영</span></button></div>
            : <div className="composer-tool-dock" role="toolbar" aria-label="게시물 첨부 도구"><button type="button" onClick={() => openFilePicker()}><Upload size={21} /><span>파일</span></button><button type="button" onClick={() => openFilePicker(".jpg,.jpeg,.png,.webp,.gif")}><ImageIcon size={21} /><span>이미지</span></button><button type="button" data-active={captureOpen} aria-pressed={captureOpen} onClick={toggleCapture}><Camera size={21} /><span>촬영</span></button><button type="button" data-active={linkOpen} aria-pressed={linkOpen} onClick={toggleLinks}><Link2 size={21} /><span>링크</span></button><button type="button" data-active={moreToolsOpen} aria-pressed={moreToolsOpen} onClick={toggleMoreTools}><SlidersHorizontal size={21} /><span>모든 도구</span></button></div>)}
        </div>
    </form>
  );

  if (!open) return null;
  if (presentation === "inline") {
    return (
      <section className="post-inline-composer" aria-labelledby={`${formId}-heading`}>
        <header className="post-inline-composer-header">
          <div>
            <span>{sectionTitle}</span>
            <h2 id={`${formId}-heading`}>게시물 수정</h2>
          </div>
          <div className="post-inline-composer-actions">
            <button type="button" className="icon-button" onClick={() => void requestCloseComposer()} aria-label="수정 취소" title="수정 취소"><X size={18} /></button>
            <button type="submit" form={formId} className="button primary composer-header-submit" disabled={submitting || queue.isUploading}>{submitting && <LoaderCircle className="spin" size={16} />}{submitLabel}</button>
          </div>
        </header>
        {composerForm}
      </section>
    );
  }

  return (
    <Modal
      open={open}
      onClose={() => { void requestCloseComposer(); }}
      title={post ? `${sectionTitle} 게시물 수정` : `${sectionTitle}에 게시물 작성`}
      className="composer-modal"
      variant="composer"
      headerAction={<button type="submit" form={formId} className="button primary composer-header-submit" disabled={submitting || queue.isUploading}>{submitting && <LoaderCircle className="spin" size={16} />}{submitLabel}</button>}
    >
      {composerForm}
    </Modal>
  );
}
