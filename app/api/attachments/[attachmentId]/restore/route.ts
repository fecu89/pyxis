import { apiError, assertSameOrigin } from "@/lib/http";

export async function POST(request: Request) {
  try {
    assertSameOrigin(request);
    return Response.json({ error: "삭제된 첨부파일은 즉시 영구 삭제되어 복구할 수 없습니다." }, { status: 410 });
  } catch (error) {
    return apiError(error, "파일을 복구하지 못했습니다.");
  }
}
