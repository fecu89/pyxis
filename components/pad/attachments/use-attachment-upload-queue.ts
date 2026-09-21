"use client";

import { useCallback, useMemo, useRef, useState } from "react";
import { uploadAttachmentFile } from "@/components/pad/attachments/upload-file";
import type {
  AttachmentUploadItem,
  UploadedAttachment,
} from "@/components/pad/attachments/types";

const defaultConcurrency = 3;

function createItem(file: File): AttachmentUploadItem {
  return {
    id: crypto.randomUUID(),
    file,
    status: "queued",
    progress: 0,
    error: null,
    attachment: null,
  };
}

export type AttachmentUploadResult = {
  successful: { id: string; file: File; attachment: UploadedAttachment }[];
  failed: { id: string; file: File; error: string }[];
  cancelled: { id: string; file: File }[];
};

export function useAttachmentUploadQueue(options?: { concurrency?: number }) {
  const concurrency = Math.min(3, Math.max(1, options?.concurrency ?? defaultConcurrency));
  const [items, setItems] = useState<AttachmentUploadItem[]>([]);
  const itemsRef = useRef<AttachmentUploadItem[]>([]);
  const requests = useRef(new Map<string, XMLHttpRequest>());
  const cancelledIds = useRef(new Set<string>());
  const running = useRef(false);

  const updateItems = useCallback((updater: (current: AttachmentUploadItem[]) => AttachmentUploadItem[]) => {
    const next = updater(itemsRef.current);
    itemsRef.current = next;
    setItems(next);
  }, []);

  const patchItem = useCallback((id: string, patch: Partial<AttachmentUploadItem>) => {
    updateItems((current) => current.map((item) => item.id === id ? { ...item, ...patch } : item));
  }, [updateItems]);

  const addFiles = useCallback((files: File[]) => {
    const created = files.map(createItem);
    updateItems((current) => [...current, ...created]);
    return created.map((item) => item.id);
  }, [updateItems]);

  const remove = useCallback((id: string) => {
    cancelledIds.current.add(id);
    requests.current.get(id)?.abort();
    requests.current.delete(id);
    updateItems((current) => current.filter((item) => item.id !== id));
  }, [updateItems]);

  const removeMany = useCallback((ids: Iterable<string>) => {
    const targets = new Set(ids);
    if (!targets.size) return;
    for (const id of targets) {
      cancelledIds.current.add(id);
      requests.current.get(id)?.abort();
      requests.current.delete(id);
    }
    updateItems((current) => current.filter((item) => !targets.has(item.id)));
  }, [updateItems]);

  const cancel = useCallback((id: string) => {
    cancelledIds.current.add(id);
    const request = requests.current.get(id);
    if (request) request.abort();
    requests.current.delete(id);
    patchItem(id, { status: "cancelled", error: null });
  }, [patchItem]);

  const reset = useCallback(() => {
    for (const request of requests.current.values()) request.abort();
    requests.current.clear();
    cancelledIds.current.clear();
    running.current = false;
    itemsRef.current = [];
    setItems([]);
  }, []);

  const clearCompleted = useCallback(() => {
    updateItems((current) => current.filter((item) => item.status !== "success" && item.status !== "cancelled"));
  }, [updateItems]);

  const start = useCallback(async (postId: string, onlyIds?: string[]): Promise<AttachmentUploadResult> => {
    if (running.current) throw new Error("이미 파일을 업로드하고 있습니다.");
    running.current = true;
    const selectedIds = onlyIds ? new Set(onlyIds) : null;
    const queue = itemsRef.current.filter((item) => (
      (!selectedIds || selectedIds.has(item.id))
      && (["queued", "error"].includes(item.status) || (selectedIds !== null && item.status === "cancelled"))
    ));
    const queueIds = new Set(queue.map((item) => item.id));
    for (const id of queueIds) cancelledIds.current.delete(id);
    updateItems((current) => current.map((item) => queueIds.has(item.id)
      ? { ...item, status: "queued", progress: 0, error: null }
      : item));

    const successful: AttachmentUploadResult["successful"] = [];
    const failed: AttachmentUploadResult["failed"] = [];
    const cancelled: AttachmentUploadResult["cancelled"] = [];
    let cursor = 0;

    async function worker() {
      while (cursor < queue.length) {
        const item = queue[cursor];
        cursor += 1;
        if (cancelledIds.current.has(item.id)) {
          cancelled.push({ id: item.id, file: item.file });
          patchItem(item.id, { status: "cancelled", error: null });
          continue;
        }
        patchItem(item.id, { status: "uploading", progress: 0, error: null });
        try {
          const attachment = await uploadAttachmentFile(postId, item.file, {
            onProgress: (progress) => patchItem(item.id, { progress }),
            onRequest: (request) => {
              if (request) requests.current.set(item.id, request);
              else requests.current.delete(item.id);
            },
          });
          successful.push({ id: item.id, file: item.file, attachment });
          patchItem(item.id, { status: "success", progress: 100, attachment });
        } catch (error) {
          requests.current.delete(item.id);
          if (error instanceof DOMException && error.name === "AbortError") {
            cancelled.push({ id: item.id, file: item.file });
            patchItem(item.id, { status: "cancelled", error: null });
          } else {
            const message = error instanceof Error ? error.message : "파일을 업로드하지 못했습니다.";
            failed.push({ id: item.id, file: item.file, error: message });
            patchItem(item.id, { status: "error", error: message });
          }
        }
      }
    }

    try {
      await Promise.all(Array.from(
        { length: Math.min(concurrency, queue.length) },
        () => worker(),
      ));
      return { successful, failed, cancelled };
    } finally {
      running.current = false;
    }
  }, [concurrency, patchItem, updateItems]);

  const retry = useCallback((postId: string, id: string) => start(postId, [id]), [start]);
  const activeCount = useMemo(
    () => items.filter((item) => item.status === "uploading").length,
    [items],
  );

  return {
    items,
    activeCount,
    isUploading: activeCount > 0,
    addFiles,
    remove,
    removeMany,
    cancel,
    reset,
    clearCompleted,
    start,
    retry,
  };
}
