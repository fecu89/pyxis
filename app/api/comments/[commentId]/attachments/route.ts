import { getBoardMutationAccess } from "@/lib/board/mutation-access";
import { canUploadFile, hasSystemPermission, isBoardFrozen } from "@/lib/auth/authorization";
import { getCurrentUser } from "@/lib/auth/current-user";
import { resolveGuestCommentOwner } from "@/lib/board/guest-access";
import { boardCommentEventDelivery } from "@/lib/board/post-snapshot";
import { createPostUploadDirectory } from "@/lib/files/paths";
import { storeAttachmentUpload } from "@/lib/files/store-upload";
import { AttachmentLimitError, guestMaxUploadBytes } from "@/lib/files/validation";
import { apiError, assertSameOrigin } from "@/lib/http";
import { getPrisma } from "@/lib/prisma";
import { publishBoardEvent } from "@/lib/realtime/board-events";
import { assertRateLimit } from "@/lib/security/rate-limit";

export const runtime = "nodejs";

export async function POST(request: Request, { params }: { params: Promise<{ commentId: string }> }) {
  let cleanup: (() => Promise<void>) | null = null;
  try {
    assertSameOrigin(request);
    const user = await getCurrentUser();
    // 게시물 첨부와 같은 sharp 이미지 변환 경로를 쓰므로 같은 기준으로 제한합니다. 손님은
    // 댓글을 찾기 전에 IP로 먼저 한 번 거릅니다.
    if (user) {
      assertRateLimit(request, {
        scope: "attachment-upload",
        userId: user.id,
        windowMs: 5 * 60_000,
        maxAttempts: 60,
        message: "파일을 너무 많이 올렸습니다. 잠시 후 다시 시도해 주세요.",
      });
    } else {
      assertRateLimit(request, {
        scope: "guest-attachment-upload-ip",
        windowMs: 60_000,
        maxAttempts: 40,
        message: "파일을 너무 많이 올렸습니다. 잠시 후 다시 시도해 주세요.",
      });
    }
    const { commentId } = await params;
    const prisma = getPrisma();
    const comment = await prisma.comment.findFirst({
      where: { id: commentId, deletedAt: null, post: { deletedAt: null, board: { deletedAt: null } } },
      select: {
        id: true,
        authorId: true,
        guestId: true,
        postId: true,
        post: { select: { boardId: true, authorId: true, guestId: true, status: true, deletedAt: true } },
      },
    });
    if (!comment) return Response.json({ error: "댓글을 찾을 수 없습니다." }, { status: 404 });
    const access = await getBoardMutationAccess(comment.post.boardId, user);
    if (!access) return Response.json({ error: "댓글 파일 업로드 권한이 없습니다." }, { status: 403 });

    const guest = user ? null : await resolveGuestCommentOwner(comment.post.boardId, access.board, comment);
    if (!user) {
      if (!guest) return Response.json({ error: "댓글 파일 업로드 권한이 없습니다." }, { status: 403 });
      assertRateLimit(request, {
        scope: "attachment-upload",
        userId: `guest:${guest.guestId}`,
        windowMs: 5 * 60_000,
        maxAttempts: 15,
        message: "파일을 너무 많이 올렸습니다. 잠시 후 다시 시도해 주세요.",
      });
    } else {
      const canEdit = user.id === comment.authorId || user.role === "SUPER_ADMIN" || hasSystemPermission(user, "EDIT_ANY_CONTENT");
      if (!canEdit || !canUploadFile(user, access)) return Response.json({ error: "댓글 파일 업로드 권한이 없습니다." }, { status: 403 });
    }
    if (isBoardFrozen(access)) return Response.json({ error: "동결된 패드에는 댓글 파일을 올릴 수 없습니다." }, { status: 409 });

    // 손님은 글과 같은 규칙으로 사진만 올립니다(음성은 계정이 있는 사람 몫).
    const uploadContext = {
      target: "댓글 첨부",
      userId: user?.id,
      guestId: guest?.guestId,
      boardId: comment.post.boardId,
      postId: comment.postId,
      commentId,
    };
    const stored = await storeAttachmentUpload(
      request,
      createPostUploadDirectory(comment.post.boardId, comment.postId),
      user
        ? { allowedTypes: ["IMAGE", "AUDIO", "PDF"], context: uploadContext }
        : { allowedTypes: ["IMAGE"], maxBytes: await guestMaxUploadBytes(), context: uploadContext },
    );
    cleanup = stored.cleanup;
    const attachment = await prisma.$transaction(async (tx) => {
      const locked = await tx.$queryRaw<{ id: string }[]>`SELECT "id" FROM "Comment" WHERE "id" = ${commentId} AND "deletedAt" IS NULL FOR UPDATE`;
      if (!locked.length) throw new Error("댓글을 찾을 수 없습니다.");
      const count = await tx.attachment.count({ where: { commentId, deletedAt: null } });
      if (count >= 4) throw new AttachmentLimitError("댓글에는 첨부를 4개까지만 올릴 수 있습니다.");
      return tx.attachment.create({
        data: {
          postId: comment.postId,
          commentId,
          ...(user ? { uploaderId: user.id } : { guestId: guest!.guestId }),
          ...stored.data,
          sortOrder: count,
        },
        select: { id: true, type: true, originalName: true, mimeType: true, fileSize: true, width: true, height: true, altText: true, caption: true, externalUrl: true, previewImageUrl: true },
      });
    });
    cleanup = null;
    publishBoardEvent(comment.post.boardId, {
      type: "attachment.created",
      entityId: attachment.id,
      postId: comment.postId,
      actorId: user?.id,
      payload: { commentAttachment: { commentId, attachment } },
      delivery: boardCommentEventDelivery(comment.post, comment),
    });
    return Response.json({ attachment: { ...attachment, url: `/f/${attachment.id}` } }, { status: 201 });
  } catch (error) {
    if (cleanup) await cleanup();
    if (error instanceof AttachmentLimitError) return Response.json({ error: error.message }, { status: 400 });
    return apiError(error, "댓글 파일을 업로드하지 못했습니다.");
  }
}
