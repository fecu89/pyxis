import { canManageBoardSettings, getEffectiveBoardAccess, hasSystemPermission, requireActiveUser } from "@/lib/auth/authorization";
import { apiError } from "@/lib/http";
import { isPadTrashRestorable } from "@/lib/board/trash-policy";
import { getPrisma } from "@/lib/prisma";

function serializeItem(item: { id: string; deletedAt: Date | null } & Record<string, unknown>) {
  const deletedAt = item.deletedAt!;
  return {
    ...item,
    deletedAt: deletedAt.toISOString(),
    restorable: isPadTrashRestorable(deletedAt),
  };
}

export async function GET(_: Request, { params }: { params: Promise<{ boardId: string }> }) {
  try {
    const user = await requireActiveUser();
    const { boardId } = await params;
    const access = await getEffectiveBoardAccess(boardId, user);
    if (!access || (!access.role && !hasSystemPermission(user, "VIEW_ALL_BOARDS"))) {
      return Response.json({ error: "패드 보관함을 볼 권한이 없습니다." }, { status: 403 });
    }
    const canManage = canManageBoardSettings(user, access);
    const canModerateAll = user.role === "SUPER_ADMIN"
      || hasSystemPermission(user, "MODERATE_CONTENT")
      || ["OWNER", "ADMIN", "EDITOR"].includes(access.role ?? "");
    const canRestoreOwn = Boolean(access.role && access.role !== "VIEWER");
    if (!canManage && !canModerateAll && !canRestoreOwn) {
      return Response.json({ sections: [], posts: [], comments: [], attachments: [] }, { headers: { "Cache-Control": "private, no-store" } });
    }
    const prisma = getPrisma();
    const [sections, posts, comments] = await Promise.all([
      canManage ? prisma.section.findMany({
        where: { boardId, deletedAt: { not: null } },
        orderBy: { deletedAt: "desc" },
        take: 50,
        select: { id: true, title: true, deletedAt: true },
      }) : [],
      prisma.post.findMany({
        where: { boardId, deletedAt: { not: null }, ...(canModerateAll ? {} : { authorId: user.id }) },
        orderBy: { deletedAt: "desc" },
        take: 100,
        select: { id: true, title: true, deletedAt: true },
      }),
      prisma.comment.findMany({
        where: { post: { boardId, deletedAt: null }, deletedAt: { not: null }, ...(canModerateAll ? {} : { authorId: user.id }) },
        orderBy: { deletedAt: "desc" },
        take: 100,
        select: { id: true, body: true, deletedAt: true },
      }),
    ]);
    return Response.json({
      sections: sections.map(serializeItem),
      posts: posts.map(serializeItem),
      comments: comments.map((comment) => serializeItem({ ...comment, body: comment.body.slice(0, 100) })),
      attachments: [],
    }, { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) {
    return apiError(error, "보관함을 불러오지 못했습니다.");
  }
}
