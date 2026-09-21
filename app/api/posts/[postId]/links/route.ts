import { getBoardMutationAccess } from "@/lib/board/mutation-access";
import { canEditPost, canUploadFile, isBoardFrozen, requireActiveUser } from "@/lib/auth/authorization";
import { createLinkAttachmentSchema } from "@/lib/board/validators";
import { boardPostEventDelivery } from "@/lib/board/post-snapshot";
import { AttachmentLimitError } from "@/lib/files/validation";
import { apiError, assertSameOrigin } from "@/lib/http";
import { validatePublicLinkUrl } from "@/lib/link-preview/security";
import { getPrisma } from "@/lib/prisma";
import { publishBoardEvent } from "@/lib/realtime/board-events";

export async function POST(request: Request, { params }: { params: Promise<{ postId: string }> }) {
  try {
    assertSameOrigin(request);
    const user = await requireActiveUser();
    const { postId } = await params;
    const parsed = createLinkAttachmentSchema.safeParse(await request.json());
    if (!parsed.success) return Response.json({ error: "링크 정보를 확인해 주세요." }, { status: 400 });
    const prisma = getPrisma();
    const post = await prisma.post.findFirst({
      where: { id: postId, deletedAt: null, board: { deletedAt: null } },
      select: { boardId: true, authorId: true, guestId: true, status: true },
    });
    if (!post) return Response.json({ error: "게시물을 찾을 수 없습니다." }, { status: 404 });
    const access = await getBoardMutationAccess(post.boardId, user);
    if (!access || !canUploadFile(user, access) || !canEditPost({ user, access, postAuthorId: post.authorId })) {
      return Response.json({ error: "링크 첨부 권한이 없습니다." }, { status: 403 });
    }
    if (isBoardFrozen(access)) return Response.json({ error: "동결된 패드에는 링크를 첨부할 수 없습니다." }, { status: 409 });
    // 미리보기 UI를 거치지 않고 이 API를 직접 호출해도 내부망 URL을 이미지로 심을 수 없도록,
    // 링크와 대표 이미지 모두 저장 직전에 DNS 결과까지 공개 주소인지 다시 확인합니다.
    const [externalUrl, previewImageUrl] = await Promise.all([
      validatePublicLinkUrl(parsed.data.url),
      parsed.data.previewImageUrl ? validatePublicLinkUrl(parsed.data.previewImageUrl) : null,
    ]);
    const attachment = await prisma.$transaction(async (tx) => {
      const locked = await tx.$queryRaw<{ id: string }[]>`SELECT "id" FROM "Post" WHERE "id" = ${postId} AND "deletedAt" IS NULL FOR UPDATE`;
      if (!locked.length) throw new Error("게시물을 찾을 수 없습니다.");
      const count = await tx.attachment.count({ where: { postId, commentId: null, deletedAt: null } });
      if (count >= 20) throw new AttachmentLimitError("게시물에는 첨부를 20개까지만 추가할 수 있습니다.");
      const last = await tx.attachment.findFirst({
        where: { postId, commentId: null, deletedAt: null },
        orderBy: { sortOrder: "desc" },
        select: { sortOrder: true },
      });
      return tx.attachment.create({
        data: {
          postId,
          uploaderId: user.id,
          type: "LINK",
          originalName: parsed.data.title,
          storedName: null,
          storagePath: null,
          mimeType: "text/uri-list",
          fileSize: 0,
          externalUrl,
          previewImageUrl,
          caption: parsed.data.description || null,
          sortOrder: (last?.sortOrder ?? -1) + 1,
        },
        select: { id: true, type: true, originalName: true, mimeType: true, fileSize: true, width: true, height: true, altText: true, caption: true, externalUrl: true, previewImageUrl: true },
      });
    });
    publishBoardEvent(post.boardId, {
      type: "attachment.created",
      entityId: attachment.id,
      postId,
      actorId: user.id,
      payload: { attachment },
      delivery: boardPostEventDelivery(post),
    });
    return Response.json({ attachment }, { status: 201 });
  } catch (error) {
    if (error instanceof AttachmentLimitError) return Response.json({ error: error.message }, { status: 400 });
    return apiError(error, "링크를 첨부하지 못했습니다.");
  }
}
