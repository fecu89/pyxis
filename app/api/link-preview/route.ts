import { z } from "zod";
import { requireCurrentUser } from "@/lib/auth/current-user";
import { apiError, assertSameOrigin } from "@/lib/http";
import { fetchLinkPreview } from "@/lib/link-preview/fetch-preview";
import { LinkPreviewError } from "@/lib/link-preview/security";
import { createRateLimiter } from "@/lib/security/rate-limit";

export const runtime = "nodejs";
export const maxDuration = 10;

const requestSchema = z.object({
  url: z.string().trim().min(1, "URL을 입력해 주세요.").max(2048, "URL은 2,048자 이하여야 합니다."),
});

const rateLimiter = createRateLimiter({ windowMs: 60_000, maxAttempts: 20 });

export async function POST(request: Request) {
  try {
    assertSameOrigin(request);
    const user = await requireCurrentUser();
    if (!rateLimiter.consume(user.id)) {
      return Response.json(
        { error: "링크 미리보기를 너무 자주 요청했습니다. 잠시 후 다시 시도해 주세요." },
        { status: 429, headers: { "Cache-Control": "private, no-store", "Retry-After": "60" } },
      );
    }

    const parsed = requestSchema.safeParse(await request.json());
    if (!parsed.success) {
      return Response.json(
        { error: parsed.error.issues[0]?.message ?? "URL을 확인해 주세요." },
        { status: 400, headers: { "Cache-Control": "private, no-store" } },
      );
    }
    const preview = await fetchLinkPreview(parsed.data.url);
    return Response.json(
      { preview },
      { headers: { "Cache-Control": "private, no-store" } },
    );
  } catch (error) {
    if (error instanceof LinkPreviewError) {
      return Response.json(
        { error: error.message },
        { status: error.status, headers: { "Cache-Control": "private, no-store" } },
      );
    }
    return apiError(error, "링크 미리보기를 만들지 못했습니다.");
  }
}
