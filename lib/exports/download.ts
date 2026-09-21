// 첨부 스트리밍 라우트(app/files/[attachmentId]/route.ts)와 같은 방식으로, ASCII fallback과
// RFC 5987 UTF-8 인코딩을 함께 내려 한글 파일명도 대부분의 브라우저에서 올바르게 저장되게 합니다.
export function contentDisposition(filename: string): string {
  const fallback = filename.replace(/[^\x20-\x7E]/g, "_").replace(/["\\]/g, "_").slice(0, 120) || "download";
  return `attachment; filename="${fallback}"; filename*=UTF-8''${encodeURIComponent(filename)}`;
}
