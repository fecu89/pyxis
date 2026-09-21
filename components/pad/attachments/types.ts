export type AttachmentDownloadPolicy = "READERS" | "MEMBERS" | "EDITORS" | "DISABLED";

export type AttachmentViewData = {
  id: string;
  type: "IMAGE" | "PDF" | "DOCUMENT" | "VIDEO" | "AUDIO" | "FILE" | "LINK";
  originalName: string;
  mimeType: string;
  fileSize: number;
  width: number | null;
  height: number | null;
  altText?: string | null;
  caption?: string | null;
  externalUrl?: string | null;
  previewImageUrl?: string | null;
  sortOrder?: number;
};

export type AttachmentMetadataInput = {
  altText: string | null;
  caption: string | null;
};

export type UploadedAttachment = AttachmentViewData & {
  url?: string;
};

export type UploadStatus = "queued" | "uploading" | "success" | "error" | "cancelled";

export type AttachmentUploadItem = {
  id: string;
  file: File;
  status: UploadStatus;
  progress: number;
  error: string | null;
  attachment: UploadedAttachment | null;
};
