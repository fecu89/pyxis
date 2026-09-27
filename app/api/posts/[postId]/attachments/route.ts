import { getBoardMutationAccess } from "@/lib/board/mutation-access";
import { canEditPost, canUploadFile, isBoardFrozen, isBoardScopedPostEdit } from "@/lib/auth/authorization";
import { getCurrentUser } from "@/lib/auth/current-user";
import { resolveGuestPostOwner } from "@/lib/board/guest-access";
import { boardPostEventDelivery } from "@/lib/board/post-snapshot";
import { createAuditLogData } from "@/lib/auth/audit";
import { createPostUploadDirectory } from "@/lib/files/paths";
import { storeAttachmentUpload } from "@/lib/files/store-upload";
import { backgroundImagesEnabled, enqueueImageJob, ImageJobBusyError } from "@/lib/files/image-job-store";
import { AttachmentLimitError, guestMaxUploadBytes } from "@/lib/files/validation";
import { warmUpPdfPreview } from "@/lib/files/document-convert";
import { apiError, assertSameOrigin } from "@/lib/http";
import { getPrisma } from "@/lib/prisma";
import { publishBoardEvent } from "@/lib/realtime/board-events";
import { assertRateLimit } from "@/lib/security/rate-limit";

export const runtime = "nodejs";

export async function POST(request: Request, { params }: { params: Promise<{ postId: string }> }) {
  let cleanup: (() => Promise<void>) | null = null;
  try {
    assertSameOrigin(request);
    const user = await getCurrentUser();
    // 업로드는 sharp 변환까지 붙는 가장 비싼 경로입니다. 손님 요청은 게시물 조회 전에
    // IP로 먼저 한 번 거릅니다(신뢰 프록시가 설정된 배포에서만 동작합니다).
    if (!user) {
      assertRateLimit(request, {
        scope: "guest-attachment-upload-ip",
        windowMs: 60_000,
        maxAttempts: 40,
        message: "파일을 너무 많이 올렸습니다. 잠시 후 다시 시도해 주세요.",
      });
    }
    const { postId } = await params;
    const prisma = getPrisma();
    const post = await prisma.post.findFirst({
      where: { id: postId, deletedAt: null, board: { deletedAt: null } },
      select: { id: true, boardId: true, authorId: true, guestId: true, status: true },
    });
    if (!post) return Response.json({ error: "게시물을 찾을 수 없습니다." }, { status: 404 });
    const access = await getBoardMutationAccess(post.boardId, user);
    if (!access) return Response.json({ error: "파일 업로드 권한이 없습니다." }, { status: 403 });

    // 손님은 보드가 손님 글쓰기를 받고 있고, 그 글이 자기 글일 때만 올릴 수 있습니다.
    const guest = user ? null : await resolveGuestPostOwner(post.boardId, access.board, post);
    if (!user) {
      if (!guest) return Response.json({ error: "파일 업로드 권한이 없습니다." }, { status: 403 });
    } else if (!canUploadFile(user, access) || !canEditPost({ user, access, postAuthorId: post.authorId })) {
      return Response.json({ error: "파일 업로드 권한이 없습니다." }, { status: 403 });
    }

    // 이미지 한 장이 최대 4천만 픽셀까지 sharp로 변환되므로 업로드는 개별적으로도 제한합니다.
    // 정상 사용(게시물당 최대 20개, 한 번에 3개씩 병렬)보다 넉넉하되 스크립트 남용은 막습니다.
    // 손님은 sharp 변환이 가장 비싼 경로인데 신원이 없어 훨씬 좁게 잡습니다.
    assertRateLimit(request, {
      scope: "attachment-upload",
      userId: user?.id ?? `guest:${guest!.guestId}`,
      windowMs: 5 * 60_000,
      maxAttempts: user ? 60 : 15,
      message: "파일을 너무 많이 올렸습니다. 잠시 후 다시 시도해 주세요.",
    });
    if (isBoardFrozen(access)) return Response.json({ error: "동결된 패드에는 파일을 올릴 수 없습니다." }, { status: 409 });

    // 손님은 이미지만. 문서·압축·실행 가능한 형식은 신원 없는 업로더에게 열어 줄 이유가 없고,
    // 이미지는 메타데이터를 제거한 안전한 초기 이미지 또는 재인코딩 결과만 제공됩니다.
    const uploadContext = {
      target: "게시물 첨부",
      userId: user?.id,
      guestId: guest?.guestId,
      boardId: post.boardId,
      postId: post.id,
    };
    const stored = await storeAttachmentUpload(
      request,
      createPostUploadDirectory(post.boardId, post.id),
      user
        ? { context: uploadContext, deferImageProcessing: backgroundImagesEnabled() }
        : { allowedTypes: ["IMAGE"], maxBytes: await guestMaxUploadBytes(), context: uploadContext, deferImageProcessing: backgroundImagesEnabled() },
    );
    cleanup = stored.cleanup;
    const attachment = await prisma.$transaction(async (tx) => {
      const locked = await tx.$queryRaw<{ id: string }[]>`SELECT "id" FROM "Post" WHERE "id" = ${postId} AND "deletedAt" IS NULL FOR UPDATE`;
      if (!locked.length) throw new Error("게시물을 찾을 수 없습니다.");
      const count = await tx.attachment.count({ where: { postId, commentId: null, deletedAt: null } });
      const limit = user ? 20 : 5;
      if (count >= limit) throw new AttachmentLimitError(`게시물에는 첨부를 ${limit}개까지만 올릴 수 있습니다.`);
      const last = await tx.attachment.findFirst({
        where: { postId, commentId: null, deletedAt: null },
        orderBy: { sortOrder: "desc" },
        select: { sortOrder: true },
      });
      const created = await tx.attachment.create({
        data: {
          postId,
          ...(user ? { uploaderId: user.id } : { guestId: guest!.guestId }),
          ...stored.data,
          sortOrder: (last?.sortOrder ?? -1) + 1,
        },
        select: { id: true, type: true, originalName: true, mimeType: true, fileSize: true, width: true, height: true, imageRevision: true, altText: true, caption: true, externalUrl: true, previewImageUrl: true },
      });
      if (stored.pendingImage) await enqueueImageJob(tx, {
        attachmentId: created.id, boardId: post.boardId, postId, inputPath: stored.data.storagePath,
      });
      if (user && !isBoardScopedPostEdit(access, user.id, post.authorId)) {
        await tx.adminAuditLog.create({
          data: createAuditLogData({
            actorId: user.id,
            action: "GLOBAL_POST_UPDATED",
            entityType: "Attachment",
            entityId: created.id,
            after: { postId, operation: "created" },
          }),
        });
      }
      return created;
    });
    cleanup = null;
    // 오피스 문서는 여기서 미리 PDF로 만들어 둡니다. 교사가 올린 자료를 한 반이 곧바로 여는
    // 흐름에서 첫 열람의 대기 시간을 없앱니다. 응답을 붙잡지 않고 실패해도 무시합니다.
    warmUpPdfPreview(stored.data.storagePath, attachment.originalName);
    publishBoardEvent(post.boardId, {
      type: "attachment.created",
      entityId: attachment.id,
      postId,
      actorId: user?.id,
      payload: { attachment },
      delivery: boardPostEventDelivery(post),
    });
    return Response.json({ attachment: { ...attachment, url: `/f/${attachment.id}` } }, { status: 201 });
  } catch (error) {
    if (cleanup) await cleanup();
    if (error instanceof ImageJobBusyError) return Response.json({ error: error.message }, { status: 503, headers: { "Retry-After": "5", "Cache-Control": "no-store" } });
    if (error instanceof AttachmentLimitError) return Response.json({ error: error.message }, { status: 400 });
    return apiError(error, "파일 업로드에 실패했습니다.");
  }
}
