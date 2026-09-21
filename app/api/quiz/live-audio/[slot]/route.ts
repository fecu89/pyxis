import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import { Readable } from "node:stream";
import { resolveStoredFile } from "@/lib/files/paths";
import { getStoredQuizLiveAudio, storedQuizLiveAudioTrack } from "@/lib/quiz/live-audio";
import { isQuizLiveAudioSlot } from "@/lib/quiz/live-audio-shape";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function parseRange(header: string, size: number) {
  const match = /^bytes=(\d*)-(\d*)$/.exec(header.trim());
  if (!match) return null;
  if (!match[1] && match[2]) {
    const suffix = Number(match[2]);
    if (!Number.isInteger(suffix) || suffix <= 0) return null;
    return { start: Math.max(0, size - suffix), end: size - 1 };
  }
  const start = Number(match[1]);
  const end = match[2] ? Number(match[2]) : size - 1;
  if (!Number.isInteger(start) || !Number.isInteger(end) || start < 0 || end < start || start >= size) return null;
  return { start, end: Math.min(end, size - 1) };
}

function contentDisposition(filename: string) {
  const fallback = filename.replace(/[^\x20-\x7E]/g, "_").replace(/["\\]/g, "_").slice(0, 120) || "quiz-audio";
  return `inline; filename="${fallback}"; filename*=UTF-8''${encodeURIComponent(filename)}`;
}

export async function GET(request: Request, { params }: { params: Promise<{ slot: string }> }) {
  try {
    const { slot } = await params;
    if (!isQuizLiveAudioSlot(slot)) return new Response("음원을 찾을 수 없습니다.", { status: 404 });
    const requestedRevision = new URL(request.url).searchParams.get("v");
    if (!requestedRevision) return new Response("음원을 찾을 수 없습니다.", { status: 404 });
    const track = storedQuizLiveAudioTrack(await getStoredQuizLiveAudio(), slot, requestedRevision);
    if (!track) return new Response("음원을 찾을 수 없습니다.", { status: 404 });
    const filePath = resolveStoredFile(track.storagePath);
    const fileStat = await stat(/* turbopackIgnore: true */ filePath).catch(() => null);
    if (!fileStat?.isFile()) return new Response("음원을 찾을 수 없습니다.", { status: 404 });

    const headers = {
      "Content-Type": track.mimeType,
      "Content-Disposition": contentDisposition(track.originalName),
      "Accept-Ranges": "bytes",
      "Cache-Control": "public, max-age=31536000, immutable",
      "X-Content-Type-Options": "nosniff",
      "Content-Security-Policy": "default-src 'none'",
      ETag: `"quiz-audio-${slot}-${track.revision}"`,
    };
    const rangeHeader = request.headers.get("range");
    if (rangeHeader) {
      const range = parseRange(rangeHeader, fileStat.size);
      if (!range) return new Response(null, { status: 416, headers: { ...headers, "Content-Range": `bytes */${fileStat.size}` } });
      return new Response(Readable.toWeb(createReadStream(/* turbopackIgnore: true */ filePath, { start: range.start, end: range.end })) as ReadableStream<Uint8Array>, {
        status: 206,
        headers: { ...headers, "Content-Length": String(range.end - range.start + 1), "Content-Range": `bytes ${range.start}-${range.end}/${fileStat.size}` },
      });
    }
    if (request.headers.get("if-none-match") === headers.ETag) return new Response(null, { status: 304, headers });
    return new Response(Readable.toWeb(createReadStream(/* turbopackIgnore: true */ filePath)) as ReadableStream<Uint8Array>, {
      headers: { ...headers, "Content-Length": String(fileStat.size) },
    });
  } catch {
    return new Response("음원을 찾을 수 없습니다.", { status: 404 });
  }
}
