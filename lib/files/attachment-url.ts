import type { AttachmentViewData } from "@/components/pad/attachments/types";

export function attachmentImageUrl(attachment: { id: string; imageRevision?: number }, variant?: "thumbnail") {
  return `/f/${encodeURIComponent(attachment.id)}?v=${attachment.imageRevision ?? 0}${variant ? "&variant=thumbnail" : ""}`;
}

/** Image representation has its own clock; captions and post.version have separate lifecycles. */
export function mergeAttachmentImage<T extends AttachmentViewData>(current: T, incoming: Partial<T>): T {
  const merged = { ...current, ...incoming };
  if (incoming.imageRevision !== undefined && (current.imageRevision ?? 0) > incoming.imageRevision) {
    Object.assign(merged, { imageRevision: current.imageRevision, mimeType: current.mimeType,
      originalName: current.originalName, fileSize: current.fileSize, width: current.width, height: current.height });
  }
  return merged;
}
export function preserveImageRevisions<T extends AttachmentViewData>(current: T[], incoming: T[]): T[] {
  const byId = new Map(current.map(item => [item.id, item]));
  return incoming.map(item => {
    const previous = byId.get(item.id);
    return previous ? mergeAttachmentImage(previous, { ...item, imageRevision: item.imageRevision ?? 0 }) : item;
  });
}

/** Completion may precede the upload/save response; existing captions remain independently editable. */
export function upsertAttachmentImage<T extends AttachmentViewData>(current: T[], snapshot: T, patch: Partial<T>): T[] {
  return current.some(item => item.id === snapshot.id)
    ? current.map(item => item.id === snapshot.id ? mergeAttachmentImage(item, patch) : item)
    : [...current, snapshot];
}
