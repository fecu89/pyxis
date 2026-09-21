import "server-only";

import { createHash } from "node:crypto";
import { cache } from "react";
import type { Metadata } from "next";
import type { Prisma } from "@/generated/prisma/client";
import { boardRoutePath } from "@/lib/board/route-paths";
import { APP_NAME } from "@/lib/brand";
import { getPrisma } from "@/lib/prisma";
import { getMetadata, SITE_DESCRIPTION } from "@/utils/seo/getMetadata";

const BOARD_OPEN_GRAPH_TEMPLATE_VERSION = 1;

// 검색 결과와 sitemap에 올릴 수 있는 패드의 정본입니다. LINK는 로그인 없이 읽을 수 있어도
// 주소를 받은 사람만 보는 unlisted 범위이므로 포함하지 않습니다. 이 조건을 sitemap.ts에서
// 다시 손으로 쓰면 메타데이터는 noindex인데 사이트맵에는 남는 식으로 개인정보 경계가 갈립니다.
export const INDEXABLE_PUBLIC_BOARD_WHERE = {
  deletedAt: null,
  discoveryScope: "PUBLIC",
  visitorPermission: { not: "NO_ACCESS" },
  loginRequired: false,
  passwordHash: null,
} satisfies Prisma.BoardWhereInput;

function isIndexablePublicBoard(board: {
  discoveryScope: string;
  visitorPermission: string;
  loginRequired: boolean;
  passwordHash: string | null;
}) {
  return board.discoveryScope === "PUBLIC"
    && board.visitorPermission !== "NO_ACCESS"
    && !board.loginRequired
    && !board.passwordHash;
}

export type ShareableBoardMetadata = {
  kind: "shareable";
  id: string;
  slug: string;
  title: string;
  description: string | null;
  discoveryScope: "LINK" | "PUBLIC";
  layout: "SECTIONS" | "WALL" | "GRID" | "STREAM" | "TIMELINE" | "TABLE";
  backgroundColor: string | null;
  accentColor: string | null;
  postCount: number;
  imageVersion: string;
};

export type ProtectedBoardMetadata = {
  kind: "protected" | "not-found";
};

export type BoardShareMetadata = ShareableBoardMetadata | ProtectedBoardMetadata;

type BoardOpenGraphInputs = Omit<ShareableBoardMetadata, "kind" | "id" | "slug" | "imageVersion">;

// OG 이미지에 실제로 그려지는 값만 버전에 포함합니다. 같은 내용은 같은 URL을 계속 사용해
// 캐시를 재사용하고, 제목·색상·레이아웃·게시물 수 등이 바뀔 때만 새 URL을 발급합니다.
export function createBoardOpenGraphVersion(input: BoardOpenGraphInputs) {
  return createHash("sha256")
    .update(JSON.stringify([BOARD_OPEN_GRAPH_TEMPLATE_VERSION, input]))
    .digest("base64url")
    .slice(0, 12);
}

// 이 조회 결과는 HTML <head>와 OG 이미지 양쪽에서 사용합니다. 보호된 패드는 DB에서 제목을
// 읽더라도 반환 타입에서 제거해, 호출부 실수로 제목·설명을 노출할 여지를 줄입니다.
export const getBoardShareMetadata = cache(async (slug: string): Promise<BoardShareMetadata> => {
  const board = await getPrisma().board.findFirst({
    where: { slug, deletedAt: null },
    select: {
      id: true,
      slug: true,
      title: true,
      description: true,
      discoveryScope: true,
      visitorPermission: true,
      loginRequired: true,
      passwordHash: true,
      layout: true,
      backgroundColor: true,
      accentColor: true,
      _count: { select: { posts: { where: { deletedAt: null, status: "PUBLISHED" } } } },
    },
  });
  if (!board) return { kind: "not-found" };

  const linkShareable = board.discoveryScope === "LINK" && !board.passwordHash;
  const publicShareable = isIndexablePublicBoard(board);
  if (!linkShareable && !publicShareable) return { kind: "protected" };

  const imageInputs: BoardOpenGraphInputs = {
    title: board.title,
    description: board.description,
    discoveryScope: board.discoveryScope === "LINK" ? "LINK" : "PUBLIC",
    layout: board.layout,
    backgroundColor: board.backgroundColor,
    accentColor: board.accentColor,
    postCount: board._count.posts,
  };
  return {
    kind: "shareable",
    id: board.id,
    slug: board.slug,
    ...imageInputs,
    imageVersion: createBoardOpenGraphVersion(imageInputs),
  };
});

type BuildBoardMetadataOptions = {
  pageLabel?: string;
  pathSuffix?: string;
  alwaysNoIndex?: boolean;
};

export async function buildBoardPageMetadata(
  slug: string,
  options: BuildBoardMetadataOptions = {},
): Promise<Metadata> {
  const board = await getBoardShareMetadata(slug);
  const boardPath = boardRoutePath(slug);
  const asPath = `${boardPath}${options.pathSuffix ?? ""}`;

  if (board.kind !== "shareable") {
    return getMetadata({
      title: options.pageLabel ? `패드 ${options.pageLabel}` : "패드",
      description: SITE_DESCRIPTION,
      asPath,
      ogImage: "/opengraph-image",
      ogImageAlt: `${APP_NAME} 기본 썸네일`,
      noIndex: true,
    });
  }

  const title = options.pageLabel ? `${board.title} · ${options.pageLabel}` : board.title;
  return getMetadata({
    title,
    description: board.description,
    asPath,
    ogImage: `${boardPath}/share-image/${board.imageVersion}`,
    ogImageAlt: `${board.title} 패드 미리보기`,
    keywords: [board.title],
    // LINK는 공유 미리보기만 제공하는 unlisted URL입니다. 검색 결과에는 PUBLIC만 노출합니다.
    noIndex: options.alwaysNoIndex || board.discoveryScope !== "PUBLIC",
  });
}

export async function buildBoardPostPageMetadata(slug: string, postId: string): Promise<Metadata> {
  const board = await getBoardShareMetadata(slug);
  const boardPath = boardRoutePath(slug);
  const asPath = `${boardPath}/posts/${encodeURIComponent(postId)}`;

  // 보호된 보드에서는 로그인한 사용자가 본문을 볼 수 있더라도 <head>에 게시물 정보를 싣지
  // 않습니다. 크롤러·메신저 미리보기는 사용자 세션과 무관하게 안전한 기본 정보만 받아야 합니다.
  if (board.kind !== "shareable") {
    return getMetadata({
      title: "패드 게시물",
      description: SITE_DESCRIPTION,
      asPath,
      ogImage: "/opengraph-image",
      ogImageAlt: `${APP_NAME} 기본 썸네일`,
      noIndex: true,
    });
  }

  const post = await getPrisma().post.findFirst({
    where: { id: postId, boardId: board.id, deletedAt: null, status: "PUBLISHED" },
    select: { title: true, body: true },
  });
  if (!post) {
    return getMetadata({
      title: "패드 게시물",
      description: SITE_DESCRIPTION,
      asPath,
      ogImage: `${boardPath}/share-image/${board.imageVersion}`,
      ogImageAlt: `${board.title} 패드 미리보기`,
      noIndex: true,
    });
  }

  const postTitle = post.title?.trim() || "제목 없는 생각";
  const description = post.body.replace(/[#*_>`\-[\]]/g, " ").replace(/\s+/g, " ").trim().slice(0, 180)
    || board.description
    || SITE_DESCRIPTION;
  return getMetadata({
    title: `${postTitle} · ${board.title}`,
    description,
    asPath,
    ogImage: `${boardPath}/share-image/${board.imageVersion}`,
    ogImageAlt: `${board.title} 패드 미리보기`,
    keywords: [postTitle, board.title],
    noIndex: board.discoveryScope !== "PUBLIC",
  });
}
