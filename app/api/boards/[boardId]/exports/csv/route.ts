import { requireBoardExportAccess } from "@/lib/exports/access";
import { gatherBoardExportData } from "@/lib/exports/data";
import { buildCommentsCsv, buildPostsCsv, buildReactionsCsv } from "@/lib/exports/csv";
import { contentDisposition } from "@/lib/exports/download";
import { apiError } from "@/lib/http";

export const runtime = "nodejs";

const CSV_TYPES = ["posts", "comments", "reactions"] as const;
type CsvType = (typeof CSV_TYPES)[number];

export async function GET(request: Request, { params }: { params: Promise<{ boardId: string }> }) {
  try {
    const { boardId } = await params;
    const auth = await requireBoardExportAccess(boardId);
    if (!auth.ok) return Response.json({ error: auth.error }, { status: auth.status });

    const requestedType = new URL(request.url).searchParams.get("type");
    const type: CsvType = CSV_TYPES.includes(requestedType as CsvType) ? (requestedType as CsvType) : "posts";

    const data = await gatherBoardExportData(boardId, undefined, type === "comments");
    const csv = type === "posts" ? buildPostsCsv(data) : type === "comments" ? buildCommentsCsv(data) : buildReactionsCsv(data);
    const fileNameByType: Record<CsvType, string> = { posts: "게시물", comments: "댓글", reactions: "반응" };

    return new Response(csv, {
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": contentDisposition(`${data.boardTitle}_${fileNameByType[type]}.csv`),
      },
    });
  } catch (error) {
    return apiError(error, "CSV로 내보내지 못했습니다.");
  }
}
