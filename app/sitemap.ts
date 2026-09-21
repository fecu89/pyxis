import type { MetadataRoute } from "next";
import { boardPostRoutePath, boardRoutePath } from "@/lib/board/route-paths";
import { getPrisma } from "@/lib/prisma";
import { INDEXABLE_PUBLIC_BOARD_WHERE } from "@/utils/seo/boardMetadata";
import { SITE_URL } from "@/utils/seo/getMetadata";

export const revalidate = 3600;

const STATIC_PATHS = ["/", "/guide"] as const;
// 단일 사이트맵의 표준 상한은 50,000 URL입니다. 정적 URL 두 자리를 비워 둔 뒤 DB 조회에도
// 같은 상한을 걸어, 공개 콘텐츠가 늘어나도 한 요청이 무제한 행을 읽지 않게 합니다.
const SITEMAP_CONTENT_LIMIT = 50_000 - STATIC_PATHS.length;

function absoluteUrl(path: string) {
  return new URL(path, SITE_URL).toString();
}

// 로그인 없이 실제 내용을 읽을 수 있고 검색 공개(PUBLIC)를 명시한 패드만 나열합니다.
// LINK 패드는 공유 링크용이라 제외하고, PRIVATE·로그인 필요·비밀번호·NO_ACCESS 패드는
// 쿼리 단계에서 제목과 slug조차 가져오지 않습니다. 공개 패드의 게시물도 독립 canonical과
// 메타데이터를 가지므로 상세 URL을 함께 제공해 검색 엔진이 카드 본문까지 발견하게 합니다.
const publicPostWhere = {
  deletedAt: null,
  status: "PUBLISHED" as const,
  board: INDEXABLE_PUBLIC_BOARD_WHERE,
};

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const prisma = getPrisma();
  const boardCount = await prisma.board.count({ where: INDEXABLE_PUBLIC_BOARD_WHERE });
  const boardTake = Math.min(SITEMAP_CONTENT_LIMIT, boardCount);
  const postTake = SITEMAP_CONTENT_LIMIT - boardTake;

  const [boards, posts] = await Promise.all([
    boardTake ? prisma.board.findMany({
    where: INDEXABLE_PUBLIC_BOARD_WHERE,
    orderBy: { id: "asc" },
    take: boardTake,
    select: {
      slug: true,
      updatedAt: true,
      posts: {
        where: { deletedAt: null, status: "PUBLISHED" },
        orderBy: { updatedAt: "desc" },
        take: 1,
        select: { updatedAt: true },
      },
    },
    }) : Promise.resolve([]),
    postTake ? prisma.post.findMany({
      where: publicPostWhere,
      orderBy: { id: "asc" },
      take: postTake,
      select: { id: true, updatedAt: true, board: { select: { slug: true } } },
    }) : Promise.resolve([]),
  ]);

  const staticPages: MetadataRoute.Sitemap = STATIC_PATHS.map((path) => ({
    url: absoluteUrl(path),
  }));
  const publicBoards: MetadataRoute.Sitemap = boards.map((board) => {
    const latestPostUpdate = board.posts[0]?.updatedAt;
    const boardLastModified = latestPostUpdate && latestPostUpdate > board.updatedAt
      ? latestPostUpdate
      : board.updatedAt;
    return { url: absoluteUrl(boardRoutePath(board.slug)), lastModified: boardLastModified };
  });
  const publicPosts: MetadataRoute.Sitemap = posts.map((post) => ({
    url: absoluteUrl(boardPostRoutePath(post.board.slug, post.id)),
    lastModified: post.updatedAt,
  }));

  return [...staticPages, ...publicBoards, ...publicPosts];
}
