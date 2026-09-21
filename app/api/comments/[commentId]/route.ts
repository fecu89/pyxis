import { getBoardMutationAccess } from "@/lib/board/mutation-access";
import { canDeleteComment, canEditComment, isBoardFrozen, isBoardScopedCommentModeration } from "@/lib/auth/authorization";
import { getCurrentUser } from "@/lib/auth/current-user";
import { resolveGuestCommentOwner } from "@/lib/board/guest-access";
import { createAuditLogData } from "@/lib/auth/audit";
import { boardCommentEventDelivery } from "@/lib/board/post-snapshot";
import { updateCommentSchema } from "@/lib/board/validators";
import { validateCommentMentionUserIds, CommentMentionValidationError } from "@/lib/comments/mentions";
import { apiError, assertSameOrigin } from "@/lib/http";
import { readJsonWithLimit } from "@/lib/http-json";
import { purgeDeletedPadAttachments } from "@/lib/files/pad-trash-sweep";
import { createNotification } from "@/lib/notifications/create";
import { getPrisma } from "@/lib/prisma";
import { publishBoardEvent } from "@/lib/realtime/board-events";

const COMMENT_UPDATE_BODY_MAX_BYTES = 64 * 1024;

async function commentContext(commentId: string) {
  return getPrisma().comment.findFirst({
    where: { id: commentId, deletedAt: null, post: { deletedAt: null, board: { deletedAt: null } } },
    select: {
      id: true,
      authorId: true,
      guestId: true,
      postId: true,
      body: true,
      mentions: { select: { userId: true } },
      post: { select: { boardId: true, authorId: true, guestId: true, status: true } },
    },
  });
}

export async function PATCH(request: Request, { params }: { params: Promise<{ commentId: string }> }) {
  try {
    assertSameOrigin(request);
    const user = await getCurrentUser();
    const { commentId } = await params;
    const comment = await commentContext(commentId);
    if (!comment) return Response.json({ error: "댓글을 찾을 수 없습니다." }, { status: 404 });
    const access = await getBoardMutationAccess(comment.post.boardId, user);
    const mayEdit = access && (user
      ? canEditComment({ user, access, commentAuthorId: comment.authorId })
      : !!(await resolveGuestCommentOwner(comment.post.boardId, access.board, comment)));
    if (!mayEdit) return Response.json({ error: "댓글 수정 권한이 없습니다." }, { status: 403 });
    if (isBoardFrozen(access)) return Response.json({ error: "동결된 패드에서는 댓글을 수정할 수 없습니다." }, { status: 409 });
    const parsed = updateCommentSchema.safeParse(await readJsonWithLimit(request, COMMENT_UPDATE_BODY_MAX_BYTES));
    if (!parsed.success) return Response.json({ error: "댓글을 확인해 주세요." }, { status: 400 });
    const mentionedUserIds = await validateCommentMentionUserIds({ boardId: comment.post.boardId, postId: comment.postId, mentionedUserIds: parsed.data.mentionedUserIds });
    const previousMentionIds = new Set(comment.mentions.map((mention) => mention.userId));
    const updated = await getPrisma().$transaction(async (tx) => {
      await tx.commentMention.deleteMany({ where: { commentId } });
      if (mentionedUserIds.length) await tx.commentMention.createMany({ data: mentionedUserIds.map((userId) => ({ commentId, userId })) });
      return tx.comment.update({
        where: { id: commentId },
        data: { body: parsed.data.body },
        select: { id: true, body: true, updatedAt: true },
      });
    });
    await Promise.all(mentionedUserIds.filter((id) => !previousMentionIds.has(id)).map((userId) => createNotification({
      userId,
      actorId: user?.id ?? null,
      type: "COMMENT_MENTIONED",
      boardId: comment.post.boardId,
      postId: comment.postId,
      commentId,
    })));
    publishBoardEvent(comment.post.boardId, {
      type: "comment.updated",
      entityId: commentId,
      postId: comment.postId,
      actorId: user?.id,
      payload: { commentPatch: { id: commentId, body: updated.body } },
      delivery: boardCommentEventDelivery(comment.post, comment),
    });
    return Response.json({ comment: { ...updated, mentionedUserIds, updatedAt: updated.updatedAt.toISOString() } });
  } catch (error) {
    if (error instanceof CommentMentionValidationError) return Response.json({ error: error.message }, { status: 400 });
    return apiError(error, "댓글을 수정하지 못했습니다.");
  }
}

export async function DELETE(request: Request, { params }: { params: Promise<{ commentId: string }> }) {
  try {
    assertSameOrigin(request);
    const user = await getCurrentUser();
    const { commentId } = await params;
    const prisma = getPrisma();
    const comment = await commentContext(commentId);
    if (!comment) return Response.json({ error: "댓글을 찾을 수 없습니다." }, { status: 404 });
    const access = await getBoardMutationAccess(comment.post.boardId, user);
    const mayDelete = access && (user
      ? canDeleteComment({ user, access, commentAuthorId: comment.authorId })
      : !!(await resolveGuestCommentOwner(comment.post.boardId, access.board, comment)));
    if (!mayDelete) return Response.json({ error: "댓글 삭제 권한이 없습니다." }, { status: 403 });
    if (isBoardFrozen(access)) return Response.json({ error: "동결된 패드에서는 댓글을 삭제할 수 없습니다." }, { status: 409 });
    const deletedAt = new Date();
    let deletedAttachments: Array<{ id: string; storagePath: string | null; thumbnailPath: string | null }> = [];
    await prisma.$transaction(async (tx) => {
      await tx.comment.update({ where: { id: commentId }, data: { deletedAt } });
      deletedAttachments = await tx.attachment.findMany({
        where: { commentId },
        select: { id: true, storagePath: true, thumbnailPath: true },
      });
      await tx.attachment.updateMany({ where: { commentId, deletedAt: null }, data: { deletedAt } });
      // 손님은 전역 권한을 쓸 일이 없으니 감사 로그 대상이 아닙니다.
      if (user && !isBoardScopedCommentModeration(access, user.id, comment.authorId)) {
        await tx.adminAuditLog.create({ data: createAuditLogData({
          actorId: user.id,
          action: "GLOBAL_POST_HIDDEN",
          entityType: "Comment",
          entityId: commentId,
          before: { postId: comment.postId, deletedAt: null },
          after: { postId: comment.postId, deletedAt: deletedAt.toISOString() },
        }) });
      }
    });
    const cleanup = await purgeDeletedPadAttachments(deletedAttachments);
    const commentCount = await prisma.comment.count({ where: { postId: comment.postId, deletedAt: null } });
    publishBoardEvent(comment.post.boardId, {
      type: "comment.deleted",
      entityId: commentId,
      postId: comment.postId,
      actorId: user?.id,
      payload: { commentCount },
      delivery: boardCommentEventDelivery(comment.post, comment),
    });
    return Response.json({ ok: true, commentCount, fileCleanupFailed: cleanup.failed });
  } catch (error) {
    return apiError(error, "댓글을 삭제하지 못했습니다.");
  }
}
