import { APP_NAME } from "@/lib/brand";
import { decodeBoardRouteSlug } from "@/lib/board/route-paths";
import { getBoardShareMetadata } from "@/utils/seo/boardMetadata";
import { renderOpenGraphImage } from "@/utils/seo/openGraphImage";

export const alt = `${APP_NAME} 패드 미리보기`;
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

export default async function BoardOpenGraphImage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug: encodedSlug } = await params;
  const board = await getBoardShareMetadata(decodeBoardRouteSlug(encodedSlug));
  return renderOpenGraphImage(board.kind === "shareable" ? board : undefined);
}
