import { getBoardMutationAccess } from "@/lib/board/mutation-access";
import { canDeleteComment, isBoardFrozen, isBoardScopedCommentModeration, requireActiveUser } from "@/lib/auth/authorization";
import { createAuditLogData } from "@/lib/auth/audit";
import { toCommentAuthorDTO } from "@/lib/board/post-author";
import { boardCommentEventDelivery } from "@/lib/board/post-snapshot";
import { PAD_TRASH_RETENTION_DAYS, PAD_TRASH_RETENTION_MS } from "@/lib/board/trash-policy";
import { apiError, assertSameOrigin } from "@/lib/http";
import { getPrisma } from "@/lib/prisma";
import { publishBoardEvent } from "@/lib/realtime/board-events";

export async function POST(request: Request, { params }: { params: Promise<{ commentId: string }> }) {
  try {
    assertSameOrigin(request);
    const user = await requireActiveUser();
    const { commentId } = await params;
    const prisma = getPrisma();
    const comment = await prisma.comment.findUnique({
      where: { id: commentId },
      select: {
        id: true,
        authorId: true,
        guestId: true,
        guestName: true,
        body: true,
        createdAt: true,
        author: { select: { id: true, nameEncrypted: true, imageEncrypted: true } },
        attachments: {
          where: { deletedAt: null },
          orderBy: { sortOrder: "asc" },
          select: { id: true, type: true, originalName: true, mimeType: true, fileSize: true, width: true, height: true, altText: true, caption: true, externalUrl: true, previewImageUrl: true },
        },
        postId: true,
        deletedAt: true,
        post: { select: { boardId: true, authorId: true, guestId: true, status: true, deletedAt: true } },
      },
    });
    if (!comment?.deletedAt || comment.post.deletedAt) {
      return Response.json({ error: "복구할 댓글을 찾을 수 없습니다." }, { status: 404 });
    }
    if (Date.now() - comment.deletedAt.getTime() > PAD_TRASH_RETENTION_MS) {
      return Response.json({ error: `${PAD_TRASH_RETENTION_DAYS}일 복구 기간이 지났습니다.` }, { status: 410 });
    }
    const access = await getBoardMutationAccess(comment.post.boardId, user);
    if (!access || !canDeleteComment({ user, access, commentAuthorId: comment.authorId })) {
      return Response.json({ error: "댓글 복구 권한이 없습니다." }, { status: 403 });
    }
    if (isBoardFrozen(access)) return Response.json({ error: "동결된 패드에서는 댓글을 복구할 수 없습니다." }, { status: 409 });
    const previousDeletedAt = comment.deletedAt;
    await prisma.$transaction(async (tx) => {
      await tx.comment.update({ where: { id: commentId }, data: { deletedAt: null } });
      if (!isBoardScopedCommentModeration(access, user.id, comment.authorId)) {
        await tx.adminAuditLog.create({ data: createAuditLogData({
          actorId: user.id,
          action: "GLOBAL_POST_RESTORED",
          entityType: "Comment",
          entityId: commentId,
          before: { postId: comment.postId, deletedAt: previousDeletedAt.toISOString() },
          after: { postId: comment.postId, deletedAt: null },
        }) });
      }
    });
    const commentCount = await prisma.comment.count({ where: { postId: comment.postId, deletedAt: null } });
    publishBoardEvent(comment.post.boardId, {
      type: "comment.created",
      entityId: commentId,
      postId: comment.postId,
      actorId: user.id,
      payload: {
        commentCount,
        comment: {
          id: comment.id,
          body: comment.body,
          createdAt: comment.createdAt.toISOString(),
          attachments: comment.attachments,
          author: toCommentAuthorDTO(comment),
          isMine: false,
        },
      },
      delivery: boardCommentEventDelivery(comment.post, comment),
    });
    return Response.json({ ok: true, commentCount });
  } catch (error) {
    return apiError(error, "댓글을 복구하지 못했습니다.");
  }
}
