import { canReadEffectiveBoard, getEffectiveBoardAccess } from "@/lib/auth/authorization";
import { getCurrentUser } from "@/lib/auth/current-user";
import { apiError } from "@/lib/http";
import { getPrisma } from "@/lib/prisma";
import { assertRateLimit } from "@/lib/security/rate-limit";
import { toPublicAuthorDTO } from "@/lib/users/repository";

// 잘못된 날짜 문자열을 그대로 new Date()에 넣으면 Invalid Date가 Prisma까지 내려가 500에
// 가까운 오류로 끝납니다. 파싱되지 않으면 그 필터를 무시합니다.
function parseDate(value: string | null) {
  if (!value) return null;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

export async function GET(request: Request, { params }: { params: Promise<{ boardId: string }> }) {
  try {
    const { boardId } = await params;
    const currentUser = await getCurrentUser();
    const access = await getEffectiveBoardAccess(boardId, currentUser);
    if (!access || !canReadEffectiveBoard(currentUser, access)) {
      return Response.json({ error: "활동을 볼 권한이 없습니다." }, { status: 403 });
    }
    // 공개 보드는 비로그인도 커서 페이지네이션을 무한 반복할 수 있어 상한을 둡니다.
    assertRateLimit(request, {
      scope: "board-activity",
      userId: currentUser?.id ?? null,
      windowMs: 60_000,
      maxAttempts: 120,
      message: "활동 조회를 너무 자주 요청했습니다. 잠시 후 다시 시도해 주세요.",
    });

    const url = new URL(request.url);
    const limit = Math.min(50, Math.max(1, Number(url.searchParams.get("limit") ?? "30") || 30));
    const actorId = url.searchParams.get("actorId") || undefined;
    const since = parseDate(url.searchParams.get("since"));
    const until = parseDate(url.searchParams.get("until"));
    const cursor = url.searchParams.get("cursor") || undefined;

    const prisma = getPrisma();
    const items = await prisma.boardActivity.findMany({
      where: {
        boardId,
        ...(actorId ? { actorId } : {}),
        ...(since || until ? { createdAt: { ...(since ? { gte: since } : {}), ...(until ? { lte: until } : {}) } } : {}),
      },
      orderBy: { createdAt: "desc" },
      take: limit + 1,
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
      select: {
        id: true,
        type: true,
        postId: true,
        commentId: true,
        createdAt: true,
        actor: { select: { id: true, nameEncrypted: true, imageEncrypted: true } },
      },
    });
    const hasMore = items.length > limit;
    const page = hasMore ? items.slice(0, limit) : items;

    const postIds = [...new Set(page.map((item) => item.postId).filter((id): id is string => Boolean(id)))];
    const posts = postIds.length ? await prisma.post.findMany({ where: { id: { in: postIds } }, select: { id: true, title: true } }) : [];
    const postById = new Map(posts.map((post) => [post.id, post]));

    return Response.json({
      activities: page.map((item) => ({
        id: item.id,
        type: item.type,
        createdAt: item.createdAt.toISOString(),
        actor: item.actor ? toPublicAuthorDTO(item.actor) : null,
        post: item.postId ? postById.get(item.postId) ?? null : null,
      })),
      nextCursor: hasMore ? page.at(-1)?.id ?? null : null,
    });
  } catch (error) {
    return apiError(error, "활동 내역을 불러오지 못했습니다.");
  }
}
