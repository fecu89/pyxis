"use client";

import type { UploadedAttachment } from "@/components/pad/attachments/types";

type UploadFileOptions = {
  onProgress: (progress: number) => void;
  onRequest: (request: XMLHttpRequest | null) => void;
};

export function uploadAttachmentFile(postId: string, file: File, options: UploadFileOptions) {
  return new Promise<UploadedAttachment>((resolve, reject) => {
    const request = new XMLHttpRequest();
    options.onRequest(request);
    request.open("POST", `/api/posts/${encodeURIComponent(postId)}/attachments`);
    request.responseType = "json";
    request.upload.addEventListener("progress", (event) => {
      if (!event.lengthComputable || event.total <= 0) return;
      options.onProgress(Math.min(99, Math.round((event.loaded / event.total) * 100)));
    });
    request.addEventListener("load", () => {
      options.onRequest(null);
      const response = request.response as { attachment?: UploadedAttachment; error?: string } | null;
      if (request.status >= 200 && request.status < 300 && response?.attachment) {
        options.onProgress(100);
        resolve(response.attachment);
        return;
      }
      reject(new Error(response?.error || "파일을 업로드하지 못했습니다."));
    });
    request.addEventListener("error", () => {
      options.onRequest(null);
      reject(new Error("파일 업로드 중 네트워크 오류가 발생했습니다."));
    });
    request.addEventListener("abort", () => {
      options.onRequest(null);
      reject(new DOMException("파일 업로드를 취소했습니다.", "AbortError"));
    });

    const body = new FormData();
    body.append("file", file);
    request.send(body);
  });
}
