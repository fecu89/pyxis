import { canPurgeAttachment, isBoardFrozen, isBoardScopedCommentModeration, isBoardScopedPostEdit, requireActiveUser } from "@/lib/auth/authorization";
import { getBoardMutationAccess } from "@/lib/board/mutation-access";
import { createAuditLogData } from "@/lib/auth/audit";
import { removeStoredAttachmentFiles } from "@/lib/files/cleanup";
import { apiError, assertSameOrigin } from "@/lib/http";
import { getPrisma } from "@/lib/prisma";

export async function DELETE(request: Request, { params }: { params: Promise<{ attachmentId: string }> }) {
  try {
    assertSameOrigin(request);
    const user = await requireActiveUser();
    const { attachmentId } = await params;
    const prisma = getPrisma();
    const attachment = await prisma.attachment.findFirst({
      where: { id: attachmentId, deletedAt: { not: null } },
      select: {
        postId: true,
        commentId: true,
        deletedAt: true,
        storagePath: true,
        thumbnailPath: true,
        post: { select: { boardId: true, authorId: true, deletedAt: true } },
        comment: { select: { authorId: true } },
      },
    });
    if (!attachment?.deletedAt || attachment.post.deletedAt) return Response.json({ error: "먼저 파일을 삭제해 주세요." }, { status: 409 });
    const access = await getBoardMutationAccess(attachment.post.boardId, user);
    const commentAuthorId = attachment.comment?.authorId ?? null;
    if (!access || !canPurgeAttachment({ user, access, postAuthorId: attachment.post.authorId, commentAuthorId })) {
      return Response.json({ error: "파일 영구 삭제 권한이 없습니다." }, { status: 403 });
    }
    if (isBoardFrozen(access)) return Response.json({ error: "동결된 패드에서는 파일을 영구 삭제할 수 없습니다." }, { status: 409 });
    const boardScoped = commentAuthorId !== null
      ? isBoardScopedCommentModeration(access, user.id, commentAuthorId)
      : isBoardScopedPostEdit(access, user.id, attachment.post.authorId);
    await prisma.$transaction(async (transaction) => {
      await transaction.attachment.delete({ where: { id: attachmentId } });
      if (!boardScoped) {
        await transaction.adminAuditLog.create({ data: createAuditLogData({ actorId: user.id, action: "GLOBAL_ENTITY_PURGED", entityType: "Attachment", entityId: attachmentId }) });
      }
    });
    const cleanup = await removeStoredAttachmentFiles([attachment]);
    return Response.json({ ok: true, purged: true, removedFiles: cleanup.removed, fileCleanupFailed: cleanup.failed });
  } catch (error) {
    return apiError(error, "파일을 영구 삭제하지 못했습니다.");
  }
}
