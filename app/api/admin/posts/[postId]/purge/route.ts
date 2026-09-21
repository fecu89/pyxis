import { canPurgePost, isBoardFrozen, requireActiveUser } from "@/lib/auth/authorization";
import { getBoardMutationAccess } from "@/lib/board/mutation-access";
import { createAuditLogData } from "@/lib/auth/audit";
import { removeStoredAttachmentFiles } from "@/lib/files/cleanup";
import { apiError, assertSameOrigin } from "@/lib/http";
import { getPrisma } from "@/lib/prisma";

export async function DELETE(request: Request, { params }: { params: Promise<{ postId: string }> }) {
  try {
    assertSameOrigin(request);
    const user = await requireActiveUser();
    const { postId } = await params;
    const prisma = getPrisma();
    const post = await prisma.post.findFirst({ where: { id: postId, deletedAt: { not: null } }, select: { boardId: true, authorId: true, deletedAt: true, attachments: { select: { storagePath: true, thumbnailPath: true } } } });
    if (!post?.deletedAt) return Response.json({ error: "먼저 게시물을 숨김 처리해 주세요." }, { status: 409 });
    const access = await getBoardMutationAccess(post.boardId, user);
    if (!access || !canPurgePost({ user, access, postAuthorId: post.authorId })) return Response.json({ error: "게시물 영구 삭제 권한이 없습니다." }, { status: 403 });
    if (isBoardFrozen(access)) return Response.json({ error: "동결된 패드에서는 게시물을 영구 삭제할 수 없습니다." }, { status: 409 });
    const boardScoped = !!access.role && (["OWNER", "ADMIN", "EDITOR"].includes(access.role) || user.id === post.authorId);
    await prisma.$transaction(async (transaction) => {
      await transaction.post.delete({ where: { id: postId } });
      if (!boardScoped) {
        await transaction.adminAuditLog.create({ data: createAuditLogData({ actorId: user.id, action: "GLOBAL_ENTITY_PURGED", entityType: "Post", entityId: postId }) });
      }
    });
    const cleanup = await removeStoredAttachmentFiles(post.attachments);
    return Response.json({ ok: true, purged: true, removedFiles: cleanup.removed, fileCleanupFailed: cleanup.failed });
  } catch (error) {
    return apiError(error, "게시물을 영구 삭제하지 못했습니다.");
  }
}
