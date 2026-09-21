import "server-only";

import { LinkPreviewError } from "@/lib/link-preview/security";
import type { LinkPreview } from "@/lib/link-preview/types";
import { getYouTubeVideoId } from "@/lib/link-preview/youtube-url";

const maximumOEmbedBytes = 64 * 1024;
const requestTimeoutMs = 5_000;

async function readLimitedBody(response: Response) {
  const reader = response.body?.getReader();
  if (!reader) return "";
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > maximumOEmbedBytes) {
        await reader.cancel();
        throw new LinkPreviewError("YouTube 미리보기 응답이 너무 큽니다.", 413);
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  return Buffer.concat(chunks.map((chunk) => Buffer.from(chunk)), size).toString("utf8");
}

function cleanText(value: unknown, maximumLength: number) {
  if (typeof value !== "string") return null;
  const cleaned = value.replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim();
  return cleaned ? cleaned.slice(0, maximumLength) : null;
}

// 사용자 URL을 외부 요청 주소로 그대로 사용하지 않습니다. 검증한 11자리 영상 ID만 고정된
// YouTube oEmbed 엔드포인트에 넣고, 응답의 iframe HTML은 버린 채 텍스트와 썸네일 URL만 취합니다.
export async function fetchYouTubePreview(url: URL): Promise<LinkPreview | null> {
  const videoId = getYouTubeVideoId(url);
  if (!videoId) return null;

  const canonical = new URL("https://www.youtube.com/watch");
  canonical.searchParams.set("v", videoId);
  const endpoint = new URL("https://www.youtube.com/oembed");
  endpoint.searchParams.set("url", canonical.toString());
  endpoint.searchParams.set("format", "json");

  let response: Response;
  try {
    response = await fetch(endpoint, {
      headers: {
        Accept: "application/json",
        "User-Agent": "PyxCourse-LinkPreview/1.0",
      },
      redirect: "error",
      signal: AbortSignal.timeout(requestTimeoutMs),
    });
  } catch {
    throw new LinkPreviewError("YouTube 미리보기에 연결하지 못했습니다.", 422);
  }
  if (!response.ok || !response.headers.get("content-type")?.toLowerCase().includes("application/json")) {
    throw new LinkPreviewError("YouTube 미리보기를 가져오지 못했습니다.", 422);
  }

  let payload: Record<string, unknown>;
  try {
    payload = JSON.parse(await readLimitedBody(response)) as Record<string, unknown>;
  } catch (error) {
    if (error instanceof LinkPreviewError) throw error;
    throw new LinkPreviewError("YouTube 미리보기 형식이 올바르지 않습니다.", 422);
  }

  const title = cleanText(payload.title, 180);
  const image = typeof payload.thumbnail_url === "string" ? payload.thumbnail_url : null;
  if (!title) throw new LinkPreviewError("YouTube 영상 제목을 확인하지 못했습니다.", 422);
  return {
    url: canonical.toString(),
    title,
    description: null,
    image,
    siteName: "YouTube",
  };
}
