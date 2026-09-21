import { canModeratePosts, getEffectiveBoardAccess, requireActiveUser } from "@/lib/auth/authorization";
import { apiError } from "@/lib/http";
import { getPrisma } from "@/lib/prisma";
import { toPostAuthorDTO } from "@/lib/board/post-author";

const PENDING_POST_PAGE_SIZE = 50;

export async function GET(request: Request, { params }: { params: Promise<{ boardId: string }> }) {
  try {
    const user = await requireActiveUser();
    const { boardId } = await params;
    const access = await getEffectiveBoardAccess(boardId, user);
    if (!access || !canModeratePosts(user, access)) {
      return Response.json({ error: "승인 대기함을 볼 권한이 없습니다." }, { status: 403 });
    }
    const page = Math.max(1, Math.min(10_000, Number.parseInt(new URL(request.url).searchParams.get("page") ?? "1", 10) || 1));
    const where = { boardId, status: "PENDING" as const, deletedAt: null };
    const prisma = getPrisma();
    const [posts, totalCount] = await Promise.all([
      prisma.post.findMany({
        where,
        orderBy: { createdAt: "asc" },
        skip: (page - 1) * PENDING_POST_PAGE_SIZE,
        take: PENDING_POST_PAGE_SIZE,
        select: {
        id: true,
        sectionId: true,
        title: true,
        body: true,
        createdAt: true,
        author: { select: { id: true, nameEncrypted: true, imageEncrypted: true } },
        // 손님 글은 author가 null이라 표시 이름을 함께 읽습니다.
        guestName: true,
        section: { select: { title: true } },
        },
      }),
      prisma.post.count({ where }),
    ]);
    return Response.json({
      posts: posts.map((post) => ({
        id: post.id,
        sectionId: post.sectionId,
        sectionTitle: post.section?.title ?? null,
        title: post.title,
        body: post.body,
        createdAt: post.createdAt.toISOString(),
        author: toPostAuthorDTO(post),
      })), page, pageSize: PENDING_POST_PAGE_SIZE, totalCount,
    });
  } catch (error) {
    return apiError(error, "승인 대기함을 불러오지 못했습니다.");
  }
}
