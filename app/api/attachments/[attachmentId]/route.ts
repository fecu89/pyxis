import { getBoardMutationAccess } from "@/lib/board/mutation-access";
import { canDeleteComment, canEditPost, isBoardFrozen, isBoardScopedPostEdit } from "@/lib/auth/authorization";
import { getCurrentUser } from "@/lib/auth/current-user";
import { resolveGuestPostOwner } from "@/lib/board/guest-access";
import { boardPostEventDelivery } from "@/lib/board/post-snapshot";
import { createAuditLogData } from "@/lib/auth/audit";
import { attachmentMetadataSchema } from "@/lib/board/validators";
import { apiError, assertSameOrigin } from "@/lib/http";
import { readJsonWithLimit } from "@/lib/http-json";
import { purgeDeletedPadAttachments } from "@/lib/files/pad-trash-sweep";
import { getPrisma } from "@/lib/prisma";
import { publishBoardEvent } from "@/lib/realtime/board-events";

const ATTACHMENT_METADATA_BODY_MAX_BYTES = 64 * 1024;

async function attachmentContext(attachmentId: string) {
  return getPrisma().attachment.findUnique({
    where: { id: attachmentId, deletedAt: null },
    select: {
      id: true,
      postId: true,
      commentId: true,
      type: true,
      storagePath: true,
      thumbnailPath: true,
      post: { select: { boardId: true, authorId: true, guestId: true, status: true, deletedAt: true } },
      comment: { select: { authorId: true, deletedAt: true } },
    },
  });
}

type Actor = Awaited<ReturnType<typeof getCurrentUser>>;

/**
 * 이 첨부를 다룰 수 있는지. 손님은 **자기 글에 달린 첨부만** 만질 수 있고, 댓글 첨부는
 * 손님에게 열려 있지 않습니다(손님은 댓글을 쓸 수 없으므로 자기 댓글이 존재할 수 없습니다).
 */
async function canManage(
  user: Actor,
  access: NonNullable<Awaited<ReturnType<typeof getBoardMutationAccess>>>,
  attachment: NonNullable<Awaited<ReturnType<typeof attachmentContext>>>,
) {
  if (!user) {
    if (attachment.comment) return false;
    return !!(await resolveGuestPostOwner(attachment.post.boardId, access.board, attachment.post));
  }
  if (attachment.comment) {
    return !attachment.comment.deletedAt && canDeleteComment({ user, access, commentAuthorId: attachment.comment.authorId });
  }
  return canEditPost({ user, access, postAuthorId: attachment.post.authorId });
}

export async function PATCH(request: Request, { params }: { params: Promise<{ attachmentId: string }> }) {
  try {
    assertSameOrigin(request);
    const user = await getCurrentUser();
    const { attachmentId } = await params;
    const attachment = await attachmentContext(attachmentId);
    if (!attachment || attachment.post.deletedAt) return Response.json({ error: "파일을 찾을 수 없습니다." }, { status: 404 });
    const access = await getBoardMutationAccess(attachment.post.boardId, user);
    if (!access || !(await canManage(user, access, attachment))) return Response.json({ error: "첨부 설명 수정 권한이 없습니다." }, { status: 403 });
    if (isBoardFrozen(access)) return Response.json({ error: "동결된 패드에서는 첨부를 수정할 수 없습니다." }, { status: 409 });
    const parsed = attachmentMetadataSchema.safeParse(await readJsonWithLimit(request, ATTACHMENT_METADATA_BODY_MAX_BYTES));
    if (!parsed.success) return Response.json({ error: "첨부 설명을 확인해 주세요." }, { status: 400 });
    const updated = await getPrisma().attachment.update({
      where: { id: attachmentId },
      data: {
        ...(attachment.type === "IMAGE" && parsed.data.altText !== undefined ? { altText: parsed.data.altText || null } : {}),
        ...(parsed.data.caption !== undefined ? { caption: parsed.data.caption || null } : {}),
      },
      select: { id: true, altText: true, caption: true },
    });
    publishBoardEvent(attachment.post.boardId, {
      type: "attachment.updated",
      entityId: attachmentId,
      postId: attachment.postId,
      actorId: user?.id,
      payload: attachment.commentId
        ? { commentAttachmentPatch: { commentId: attachment.commentId, attachmentPatch: updated } }
        : { attachmentPatch: updated },
      delivery: boardPostEventDelivery(attachment.post),
    });
    return Response.json({ attachment: updated });
  } catch (error) {
    return apiError(error, "첨부 설명을 저장하지 못했습니다.");
  }
}

export async function DELETE(request: Request, { params }: { params: Promise<{ attachmentId: string }> }) {
  try {
    assertSameOrigin(request);
    const user = await getCurrentUser();
    const { attachmentId } = await params;
    const prisma = getPrisma();
    const attachment = await attachmentContext(attachmentId);
    if (!attachment || attachment.post.deletedAt) return Response.json({ error: "파일을 찾을 수 없습니다." }, { status: 404 });
    const access = await getBoardMutationAccess(attachment.post.boardId, user);
    if (!access || !(await canManage(user, access, attachment))) return Response.json({ error: "파일 삭제 권한이 없습니다." }, { status: 403 });
    if (isBoardFrozen(access)) return Response.json({ error: "동결된 패드에서는 첨부를 삭제할 수 없습니다." }, { status: 409 });
    const deletedAt = new Date();
    await prisma.$transaction(async (tx) => {
      await tx.attachment.update({ where: { id: attachmentId }, data: { deletedAt } });
      if (user && !isBoardScopedPostEdit(access, user.id, attachment.post.authorId)) {
        await tx.adminAuditLog.create({
          data: createAuditLogData({
            actorId: user.id,
            action: "GLOBAL_POST_HIDDEN",
            entityType: "Attachment",
            entityId: attachmentId,
            before: { postId: attachment.postId, deletedAt: null },
            after: { postId: attachment.postId, deletedAt: deletedAt.toISOString() },
          }),
        });
      }
    });
    const cleanup = await purgeDeletedPadAttachments([attachment]);
    publishBoardEvent(attachment.post.boardId, {
      type: "attachment.deleted",
      entityId: attachmentId,
      postId: attachment.postId,
      actorId: user?.id,
      payload: attachment.commentId
        ? { commentAttachmentDeleted: { commentId: attachment.commentId, attachmentId } }
        : undefined,
      delivery: boardPostEventDelivery(attachment.post),
    });
    return Response.json({
      ok: true,
      purged: cleanup.purged > 0,
      fileCleanupFailed: cleanup.failed,
    });
  } catch (error) {
    return apiError(error, "파일을 삭제하지 못했습니다.");
  }
}
