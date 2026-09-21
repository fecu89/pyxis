import { z } from "zod";
import {
  canPurgeAttachment,
  canPurgeComment,
  canPurgePost,
  canPurgeSection,
  getEffectiveBoardAccess,
  isBoardScopedCommentModeration,
  isBoardScopedManagement,
  isBoardScopedPostEdit,
  requireActiveUser,
} from "@/lib/auth/authorization";
import { createAuditLogData } from "@/lib/auth/audit";
import { removeStoredAttachmentFiles } from "@/lib/files/cleanup";
import { apiError, assertSameOrigin } from "@/lib/http";
import { getPrisma } from "@/lib/prisma";

const trashKindSchema = z.enum(["sections", "posts", "comments", "attachments"]);
const schema = z.object({
  items: z.array(z.object({
    kind: trashKindSchema,
    id: z.string().min(1).max(100),
  })).min(1).max(350).refine(
    (items) => new Set(items.map((item) => `${item.kind}:${item.id}`)).size === items.length,
    "중복된 삭제 항목이 있습니다.",
  ),
});

type TrashKind = z.infer<typeof trashKindSchema>;

function idsFor(items: z.infer<typeof schema>["items"], kind: TrashKind) {
  return items.filter((item) => item.kind === kind).map((item) => item.id);
}

export async function DELETE(request: Request, { params }: { params: Promise<{ boardId: string }> }) {
  try {
    assertSameOrigin(request);
    const user = await requireActiveUser();
    const { boardId } = await params;
    const parsed = schema.safeParse(await request.json());
    if (!parsed.success) {
      return Response.json(
        { error: parsed.error.issues[0]?.message || "영구 삭제할 항목을 확인해 주세요." },
        { status: 400 },
      );
    }

    const access = await getEffectiveBoardAccess(boardId, user);
    if (!access) return Response.json({ error: "패드를 찾을 수 없거나 접근 권한이 없습니다." }, { status: 404 });

    const sectionIds = idsFor(parsed.data.items, "sections");
    const postIds = idsFor(parsed.data.items, "posts");
    const commentIds = idsFor(parsed.data.items, "comments");
    const attachmentIds = idsFor(parsed.data.items, "attachments");
    const prisma = getPrisma();
    const [sections, posts, comments, attachments] = await Promise.all([
      sectionIds.length ? prisma.section.findMany({
        where: { id: { in: sectionIds }, boardId, deletedAt: { not: null }, board: { deletedAt: null } },
        select: { id: true },
      }) : [],
      postIds.length ? prisma.post.findMany({
        where: { id: { in: postIds }, boardId, deletedAt: { not: null }, board: { deletedAt: null } },
        select: { id: true, authorId: true, sectionId: true },
      }) : [],
      commentIds.length ? prisma.comment.findMany({
        where: { id: { in: commentIds }, deletedAt: { not: null }, post: { boardId, deletedAt: null, board: { deletedAt: null } } },
        select: { id: true, authorId: true, postId: true },
      }) : [],
      attachmentIds.length ? prisma.attachment.findMany({
        where: { id: { in: attachmentIds }, deletedAt: { not: null }, post: { boardId, deletedAt: null, board: { deletedAt: null } } },
        select: {
          id: true,
          postId: true,
          commentId: true,
          storagePath: true,
          thumbnailPath: true,
          post: { select: { authorId: true } },
          comment: { select: { authorId: true } },
        },
      }) : [],
    ]);

    if (
      sections.length !== sectionIds.length
      || posts.length !== postIds.length
      || comments.length !== commentIds.length
      || attachments.length !== attachmentIds.length
    ) {
      return Response.json(
        { error: "일부 항목이 이미 처리되었거나 이 패드의 삭제 항목이 아닙니다. 목록을 새로고침해 주세요." },
        { status: 409 },
      );
    }

    if (sections.length && !canPurgeSection(user, access)) {
      return Response.json({ error: "선택한 섹션을 영구 삭제할 권한이 없습니다." }, { status: 403 });
    }
    if (posts.some((post) => !canPurgePost({ user, access, postAuthorId: post.authorId }))) {
      return Response.json({ error: "선택한 게시물 중 영구 삭제할 권한이 없는 항목이 있습니다." }, { status: 403 });
    }
    if (comments.some((comment) => !canPurgeComment({ user, access, commentAuthorId: comment.authorId }))) {
      return Response.json({ error: "선택한 댓글 중 영구 삭제할 권한이 없는 항목이 있습니다." }, { status: 403 });
    }
    if (attachments.some((attachment) => !canPurgeAttachment({
      user,
      access,
      postAuthorId: attachment.post.authorId,
      commentAuthorId: attachment.comment?.authorId ?? null,
    }))) {
      return Response.json({ error: "선택한 첨부파일 중 영구 삭제할 권한이 없는 항목이 있습니다." }, { status: 403 });
    }

    // 섹션 → 게시물, 게시물/댓글 → 첨부파일은 DB에서 함께 삭제됩니다. 부모와 자식을 동시에
    // 선택했을 때 자식을 두 번 지우지 않도록 직접 삭제할 ID만 남깁니다.
    const selectedSectionIds = new Set(sectionIds);
    const directPostIds = posts.filter((post) => !post.sectionId || !selectedSectionIds.has(post.sectionId)).map((post) => post.id);
    const selectedPostIds = new Set(directPostIds);
    const directCommentIds = comments.filter((comment) => !selectedPostIds.has(comment.postId)).map((comment) => comment.id);
    const selectedCommentIds = new Set(directCommentIds);
    const directAttachmentIds = attachments.filter((attachment) => (
      !selectedPostIds.has(attachment.postId)
      && (!attachment.commentId || !selectedCommentIds.has(attachment.commentId))
    )).map((attachment) => attachment.id);

    const cleanupScopes = [
      ...(sectionIds.length ? [{ post: { sectionId: { in: sectionIds } } }] : []),
      ...(directPostIds.length ? [{ postId: { in: directPostIds } }] : []),
      ...(directCommentIds.length ? [{ commentId: { in: directCommentIds } }] : []),
      ...(directAttachmentIds.length ? [{ id: { in: directAttachmentIds } }] : []),
    ];
    const storedFiles = await prisma.attachment.findMany({
      where: { OR: cleanupScopes },
      select: { storagePath: true, thumbnailPath: true },
    });

    const globalItems = [
      ...(!isBoardScopedManagement(access) ? sections.map((section) => ({ kind: "sections", id: section.id })) : []),
      ...posts.filter((post) => !isBoardScopedPostEdit(access, user.id, post.authorId)).map((post) => ({ kind: "posts", id: post.id })),
      ...comments.filter((comment) => !isBoardScopedCommentModeration(access, user.id, comment.authorId)).map((comment) => ({ kind: "comments", id: comment.id })),
      ...attachments.filter((attachment) => {
        const commentAuthorId = attachment.comment?.authorId ?? null;
        return commentAuthorId !== null
          ? !isBoardScopedCommentModeration(access, user.id, commentAuthorId)
          : !isBoardScopedPostEdit(access, user.id, attachment.post.authorId);
      }).map((attachment) => ({ kind: "attachments", id: attachment.id })),
    ];

    await prisma.$transaction(async (transaction) => {
      if (directAttachmentIds.length) await transaction.attachment.deleteMany({ where: { id: { in: directAttachmentIds } } });
      if (directCommentIds.length) await transaction.comment.deleteMany({ where: { id: { in: directCommentIds } } });
      if (directPostIds.length) await transaction.post.deleteMany({ where: { id: { in: directPostIds } } });
      if (sectionIds.length) {
        await transaction.post.deleteMany({ where: { sectionId: { in: sectionIds } } });
        await transaction.section.deleteMany({ where: { id: { in: sectionIds } } });
      }
      if (globalItems.length) {
        await transaction.adminAuditLog.create({
          data: createAuditLogData({
            actorId: user.id,
            action: "GLOBAL_ENTITY_PURGED",
            entityType: "TrashBatch",
            entityId: boardId,
            before: { items: globalItems },
            after: { operation: "purged", count: globalItems.length },
          }),
        });
      }
    });

    const cleanup = await removeStoredAttachmentFiles(storedFiles);
    return Response.json({
      ok: true,
      purged: parsed.data.items.length,
      removedFiles: cleanup.removed,
      fileCleanupFailed: cleanup.failed,
    });
  } catch (error) {
    return apiError(error, "선택한 항목을 영구 삭제하지 못했습니다.");
  }
}
