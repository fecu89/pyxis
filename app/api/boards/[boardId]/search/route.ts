import { canModeratePosts, canReadEffectiveBoard, getEffectiveBoardAccess } from "@/lib/auth/authorization";
import { getCurrentUser } from "@/lib/auth/current-user";
import { apiError } from "@/lib/http";
import { getPrisma } from "@/lib/prisma";
import { assertRateLimit } from "@/lib/security/rate-limit";
import { parseReactionKey } from "@/lib/reactions/validation";
import type { ReactionCounts, ReactionKey } from "@/lib/reactions/types";
import { toPostAuthorDTO } from "@/lib/board/post-author";

function reactionSummary(reactions: { key: string; userId: string }[], currentUserId: string | null) {
  const reactionCounts: ReactionCounts = {};
  const viewerReactions: ReactionKey[] = [];
  for (const reaction of reactions) {
    try {
      const key = parseReactionKey(reaction.key);
      reactionCounts[key] = (reactionCounts[key] ?? 0) + 1;
      if (reaction.userId === currentUserId) viewerReactions.push(key);
    } catch {
      continue;
    }
  }
  return {
    viewerReacted: viewerReactions.includes("LIKE"),
    reactionCount: Object.values(reactionCounts).reduce<number>((sum, count) => sum + (count ?? 0), 0),
    viewerReactions,
    reactionCounts,
  };
}

// Search runs on the server so posts outside the first SSR page remain discoverable.
export async function GET(request: Request, { params }: { params: Promise<{ boardId: string }> }) {
  try {
    const { boardId } = await params;
    // 검색어 길이를 제한하지 않으면 수십 KB짜리 문자열이 그대로 ILIKE '%...%'로 들어가
    // trigram 인덱스를 무력화한 채 순차 스캔을 유발할 수 있습니다.
    const term = (new URL(request.url).searchParams.get("q") ?? "").trim().slice(0, 100);
    if (!term) return Response.json({ posts: [] });
    const currentUser = await getCurrentUser();
    const access = await getEffectiveBoardAccess(boardId, currentUser);
    if (!access || !canReadEffectiveBoard(currentUser, access)) return Response.json({ error: "검색할 권한이 없습니다." }, { status: 403 });
    // 요청 한 건이 게시물 50개 + 첨부 + 반응을 모두 조회하고 공개 보드는 비로그인도 부를 수
    // 있으므로, 타이핑에 따른 정상 연속 검색은 통과하되 스크립트 반복은 막는 선을 둡니다.
    assertRateLimit(request, {
      scope: "board-search",
      userId: currentUser?.id ?? null,
      windowMs: 60_000,
      maxAttempts: 60,
      message: "검색을 너무 자주 요청했습니다. 잠시 후 다시 시도해 주세요.",
    });
    const canManage = Boolean(currentUser && canModeratePosts(currentUser, access));
    const posts = await getPrisma().post.findMany({
      where: {
        boardId,
        deletedAt: null,
        AND: [
          { OR: [{ title: { contains: term, mode: "insensitive" } }, { body: { contains: term, mode: "insensitive" } }] },
          canManage ? {} : { OR: [{ status: "PUBLISHED" }, ...(currentUser ? [{ authorId: currentUser.id }] : [])] },
        ],
      },
      orderBy: [{ isPinned: "desc" }, { position: "asc" }],
      take: 50,
      select: {
        id: true,
        sectionId: true,
        title: true,
        body: true,
        bodyFormat: true,
        status: true,
        moderationReason: true,
        customFieldValues: true,
        position: true,
        isPinned: true,
        version: true,
        createdAt: true,
        updatedAt: true,
        author: { select: { id: true, nameEncrypted: true, imageEncrypted: true } },
        // 손님 글은 author가 null이라 표시 이름을 함께 읽습니다.
        guestName: true,
        attachments: {
          where: { deletedAt: null, commentId: null },
          orderBy: { sortOrder: "asc" },
          select: { id: true, type: true, originalName: true, mimeType: true, fileSize: true, width: true, height: true, altText: true, caption: true, externalUrl: true, previewImageUrl: true },
        },
        reactions: { select: { key: true, userId: true } },
        _count: { select: { comments: { where: { deletedAt: null } }, reactions: true } },
      },
    });
    return Response.json({
      posts: posts.map((post) => {
        const { reactions, _count, ...postData } = post;
        return {
          ...postData,
          author: toPostAuthorDTO(post),
          createdAt: post.createdAt.toISOString(),
          updatedAt: post.updatedAt.toISOString(),
          ...reactionSummary(reactions, currentUser?.id ?? null),
          commentCount: _count.comments,
        };
      }),
    });
  } catch (error) {
    return apiError(error, "검색하지 못했습니다.");
  }
}
