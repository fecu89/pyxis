import { Readable } from "node:stream";
import { requireAttachmentZipAccess } from "@/lib/exports/access";
import { gatherBoardExportData } from "@/lib/exports/data";
import { buildAttachmentsZipStream } from "@/lib/exports/attachments-zip";
import { contentDisposition } from "@/lib/exports/download";
import { apiError } from "@/lib/http";
import { assertRateLimit } from "@/lib/security/rate-limit";

export const runtime = "nodejs";

export async function GET(request: Request, { params }: { params: Promise<{ boardId: string }> }) {
  try {
    const { boardId } = await params;
    const auth = await requireAttachmentZipAccess(boardId);
    if (!auth.ok) return Response.json({ error: auth.error }, { status: auth.status });
    assertRateLimit(request, {
      scope: `board-attachments-zip:${boardId}`,
      userId: auth.user.id,
      windowMs: 60_000,
      maxAttempts: 3,
      message: "첨부파일 압축 요청이 너무 잦습니다. 잠시 후 다시 시도해 주세요.",
    });

    // 첨부파일만 압축하므로 댓글 관계는 안 켭니다.
    const data = await gatherBoardExportData(boardId, undefined, false);
    const archive = buildAttachmentsZipStream(data);

    return new Response(Readable.toWeb(archive) as ReadableStream<Uint8Array>, {
      headers: {
        "Content-Type": "application/zip",
        "Content-Disposition": contentDisposition(`${data.boardTitle}_첨부파일.zip`),
      },
    });
  } catch (error) {
    return apiError(error, "첨부파일을 압축하지 못했습니다.");
  }
}
