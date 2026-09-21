import { apiError } from "@/lib/http";
import { assertRateLimit } from "@/lib/security/rate-limit";
import { resolveShortLinkDestination } from "@/lib/short-links/cache";
import { normalizeShortLinkSlug, shortLinkSlugError } from "@/lib/short-links/slug";

const PUBLIC_CACHE = "public, max-age=0, s-maxage=30, stale-while-revalidate=60";
const NOT_FOUND_CACHE = "public, max-age=0, s-maxage=10";

function notFoundResponse() {
  return new Response("짧은 주소를 찾을 수 없습니다.", {
    status: 404,
    headers: {
      "Cache-Control": NOT_FOUND_CACHE,
      "Content-Type": "text/plain; charset=utf-8",
      "X-Robots-Tag": "noindex, nofollow",
    },
  });
}

export async function GET(request: Request, { params }: { params: Promise<{ slug: string }> }) {
  try {
    assertRateLimit(request, {
      scope: "short-link-resolve",
      windowMs: 60_000,
      maxAttempts: 240,
      message: "짧은 주소 요청이 너무 많습니다. 잠시 후 다시 시도해 주세요.",
    });

    const slug = normalizeShortLinkSlug((await params).slug);
    if (shortLinkSlugError(slug)) return notFoundResponse();
    const destination = await resolveShortLinkDestination(slug);
    if (!destination) return notFoundResponse();

    return new Response(null, {
      status: 307,
      headers: {
        "Cache-Control": PUBLIC_CACHE,
        Location: destination,
        "X-Robots-Tag": "noindex, nofollow",
      },
    });
  } catch (error) {
    return apiError(error, "짧은 주소를 열지 못했습니다.");
  }
}
