import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import { Readable } from "node:stream";
import { getCurrentUser } from "@/lib/auth/current-user";
import { getFormAccess } from "@/lib/forms/access";
import { resolveStoredFile } from "@/lib/files/paths";
import { getPrisma } from "@/lib/prisma";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(_request: Request, { params }: { params: Promise<{ fileId: string }> }) {
  const user = await getCurrentUser();
  if (!user) return new Response("로그인이 필요합니다.", { status: 401 });
  const { fileId } = await params;
  const file = await getPrisma().formUploadedFile.findUnique({
    where: { id: fileId },
    select: { formId: true, uploaderId: true, originalName: true, storagePath: true, mimeType: true, fileSize: true, deletedAt: true },
  });
  if (!file || file.deletedAt) return new Response("파일을 찾을 수 없습니다.", { status: 404 });
  if (file.uploaderId !== user.id && !(await getFormAccess(file.formId, user))) return new Response("파일 접근 권한이 없습니다.", { status: 403 });
  const path = resolveStoredFile(file.storagePath);
  const info = await stat(path).catch(() => null);
  if (!info?.isFile()) return new Response("파일을 찾을 수 없습니다.", { status: 404 });
  const fallback = file.originalName.replace(/[^\x20-\x7E]/g, "_").replace(/["\\]/g, "_").slice(0, 120) || "download";
  return new Response(Readable.toWeb(createReadStream(path)) as ReadableStream<Uint8Array>, {
    headers: {
      "Content-Type": file.mimeType || "application/octet-stream",
      "Content-Length": String(info.size),
      "Content-Disposition": `attachment; filename="${fallback}"; filename*=UTF-8''${encodeURIComponent(file.originalName)}`,
      "X-Content-Type-Options": "nosniff",
      "Content-Security-Policy": "default-src 'none'; sandbox",
      "Cache-Control": "private, no-cache, must-revalidate",
    },
  });
}
