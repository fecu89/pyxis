import { requireBoardExportAccess } from "@/lib/exports/access";
import { gatherBoardExportData } from "@/lib/exports/data";
import { buildBoardWorkbook } from "@/lib/exports/xlsx";
import { contentDisposition } from "@/lib/exports/download";
import { apiError } from "@/lib/http";
import { assertRateLimit } from "@/lib/security/rate-limit";

export const runtime = "nodejs";

export async function GET(request: Request, { params }: { params: Promise<{ boardId: string }> }) {
  try {
    const { boardId } = await params;
    const auth = await requireBoardExportAccess(boardId);
    if (!auth.ok) return Response.json({ error: auth.error }, { status: auth.status });
    assertRateLimit(request, {
      scope: `board-xlsx-export:${boardId}`,
      userId: auth.user.id,
      windowMs: 60_000,
      maxAttempts: 5,
      message: "XLSX 내보내기 요청이 너무 잦습니다. 잠시 후 다시 시도해 주세요.",
    });

    const data = await gatherBoardExportData(boardId);
    const buffer = await buildBoardWorkbook(data);

    return new Response(buffer, {
      headers: {
        "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "Content-Disposition": contentDisposition(`${data.boardTitle}.xlsx`),
      },
    });
  } catch (error) {
    return apiError(error, "XLSX로 내보내지 못했습니다.");
  }
}
