import { Buffer } from "node:buffer";
import { unstable_cache } from "next/cache";
import { boardRoutePath, decodeBoardRouteSlug } from "@/lib/board/route-paths";
import { getBoardShareMetadata } from "@/utils/seo/boardMetadata";
import { renderOpenGraphImage } from "@/utils/seo/openGraphImage";

const VERSION_PATTERN = /^[A-Za-z0-9_-]{12}$/;
const CACHE_CONTROL = "public, max-age=300, s-maxage=3600";

type CachedImage =
  | { kind: "image"; body: string }
  | { kind: "redirect"; version: string };

// slug와 콘텐츠 버전이 캐시 키에 함께 들어갑니다. 같은 URL은 한 시간 동안 DB 조회와
// ImageResponse 렌더링을 모두 건너뛰고, 표시 내용이 바뀐 새 버전만 다시 생성합니다.
const getCachedBoardOpenGraphImage = unstable_cache(
  async (slug: string, requestedVersion: string): Promise<CachedImage> => {
    const board = await getBoardShareMetadata(slug);
    if (board.kind === "shareable" && board.imageVersion !== requestedVersion) {
      return { kind: "redirect", version: board.imageVersion };
    }

    const response = await renderOpenGraphImage(board.kind === "shareable" ? board : undefined);
    const body = Buffer.from(await response.arrayBuffer()).toString("base64");
    return { kind: "image", body };
  },
  ["board-open-graph-image-v1"],
  { revalidate: 3600 },
);

export async function GET(
  request: Request,
  { params }: { params: Promise<{ slug: string; version: string }> },
) {
  const { slug: encodedSlug, version } = await params;
  if (!VERSION_PATTERN.test(version)) {
    return new Response("Not found", {
      status: 404,
      headers: { "Cache-Control": "no-store" },
    });
  }

  const slug = decodeBoardRouteSlug(encodedSlug);
  const cached = await getCachedBoardOpenGraphImage(slug, version);
  if (cached.kind === "redirect") {
    const canonical = `${boardRoutePath(slug)}/share-image/${cached.version}`;
    const response = Response.redirect(new URL(canonical, request.url), 307);
    response.headers.set("Cache-Control", "no-store");
    return response;
  }

  return new Response(Buffer.from(cached.body, "base64"), {
    headers: {
      "Cache-Control": CACHE_CONTROL,
      "Content-Type": "image/png",
      "X-Content-Type-Options": "nosniff",
      "Content-Security-Policy": "default-src 'none'; sandbox",
    },
  });
}
