import { getBoardMutationAccess } from "@/lib/board/mutation-access";
import {
  canEditPost,
  canModeratePost,
  isBoardFrozen,
} from "@/lib/auth/authorization";
import { getCurrentUser } from "@/lib/auth/current-user";
import { resolveGuestPostOwner } from "@/lib/board/guest-access";
import { createAuditLogData } from "@/lib/auth/audit";
import { recordBoardActivity } from "@/lib/board/activity";
import { boardPostEventDelivery, readBoardPostEventSnapshot } from "@/lib/board/post-snapshot";
import { updatePostSchema } from "@/lib/board/validators";
import { apiError, assertSameOrigin } from "@/lib/http";
import { readJsonWithLimit } from "@/lib/http-json";
import { purgeDeletedPadAttachments } from "@/lib/files/pad-trash-sweep";
import { getPrisma } from "@/lib/prisma";
import { publishBoardEvent } from "@/lib/realtime/board-events";
import { defaultPostFieldConfig } from "@/lib/post-fields/defaults";
import { parsePostFieldConfig, validatePostFieldSubmission, validateSystemPostFields, PostFieldValidationError } from "@/lib/post-fields/validation";

type Actor = Awaited<ReturnType<typeof getCurrentUser>>;
const POST_UPDATE_BODY_MAX_BYTES = 512 * 1024;

async function postAccess(postId: string, user: Actor) {
  const post = await getPrisma().post.findFirst({ where: { id: postId, deletedAt: null }, select: { id: true, boardId: true, sectionId: true, authorId: true, guestId: true, status: true, title: true, body: true, isPinned: true, customFieldValues: true, board: { select: { postFieldConfig: true } } } });
  if (!post) return null;
  const access = await getBoardMutationAccess(post.boardId, user);
  return access ? { post, access } : null;
}

function boardScopedEdit(role: string | null, userId: string, authorId: string | null) {
  return !!role && (["OWNER", "ADMIN", "EDITOR"].includes(role) || userId === authorId);
}

export async function PATCH(request: Request, { params }: { params: Promise<{ postId: string }> }) {
  try {
    assertSameOrigin(request);
    const user = await getCurrentUser();
    const { postId } = await params;
    const parsed = updatePostSchema.safeParse(await readJsonWithLimit(request, POST_UPDATE_BODY_MAX_BYTES));
    if (!parsed.success) return Response.json({ error: "게시물 정보를 확인해 주세요." }, { status: 400 });
    const resolved = await postAccess(postId, user);
    if (!resolved) return Response.json({ error: "게시물을 찾을 수 없습니다." }, { status: 404 });
    const allowed = user
      ? canEditPost({ user, access: resolved.access, postAuthorId: resolved.post.authorId })
      : !!(await resolveGuestPostOwner(resolved.post.boardId, resolved.access.board, resolved.post));
    if (!allowed) return Response.json({ error: "게시물 수정 권한이 없습니다." }, { status: 403 });
    if (isBoardFrozen(resolved.access)) return Response.json({ error: "동결된 패드에서는 게시물을 수정할 수 없습니다." }, { status: 409 });
    // 전역 권한으로 남의 글을 고칠 때만 감사 로그를 남깁니다. 손님은 애초에 자기 글만
    // 통과하므로 대상이 아니고, 그래서 값 자체를 "감사 로그에 적을 actorId 또는 null"로 둡니다.
    const overrideActorId = user && !boardScopedEdit(resolved.access.role, user.id, resolved.post.authorId) ? user.id : null;
    // 손님이 고정(isPinned)을 건드리는 건 보드 전체에 영향을 주는 관리 행위라 막습니다.
    if (!user && parsed.data.isPinned !== undefined) return Response.json({ error: "게시물 고정은 관리자만 할 수 있습니다." }, { status: 403 });
    const fieldConfig = parsePostFieldConfig(resolved.post.board.postFieldConfig ?? defaultPostFieldConfig);
    const attachmentCount = await getPrisma().attachment.count({ where: { postId, commentId: null, deletedAt: null } });
    const systemFields = validateSystemPostFields(fieldConfig, {
      title: parsed.data.title ?? resolved.post.title ?? "",
      body: parsed.data.body ?? resolved.post.body,
      attachmentCount,
    }, { finalizeAttachments: parsed.data.attachmentCount !== undefined });
    const customFieldValues = parsed.data.customFieldValues !== undefined || parsed.data.fieldConfigVersion !== undefined
      ? validatePostFieldSubmission(fieldConfig, parsed.data.fieldConfigVersion ?? fieldConfig.version, parsed.data.customFieldValues ?? {})
      : undefined;
    const updated = await getPrisma().$transaction(async (transaction) => {
      const result = await transaction.post.updateMany({
        where: { id: postId, version: parsed.data.version, deletedAt: null },
        data: {
          ...(parsed.data.title !== undefined ? { title: systemFields.title || null } : {}),
          ...(parsed.data.body !== undefined ? { body: systemFields.body } : {}),
          ...(customFieldValues !== undefined ? { customFieldValues } : {}),
          isPinned: parsed.data.isPinned,
          version: { increment: 1 },
        },
      });
      if (!result.count) return null;
      if (overrideActorId) {
        await transaction.adminAuditLog.create({ data: createAuditLogData({ actorId: overrideActorId, action: "GLOBAL_POST_UPDATED", entityType: "Post", entityId: postId, after: { fields: Object.keys(parsed.data).filter((key) => key !== "body" && key !== "title") }, reason: "전역 권한으로 게시물 수정" }) });
      }
      return transaction.post.findUniqueOrThrow({ where: { id: postId }, select: { id: true, title: true, body: true, isPinned: true, version: true, updatedAt: true } });
    });
    if (!updated) return Response.json({ error: "다른 사용자가 먼저 수정했습니다. 새로고침 후 다시 시도해 주세요." }, { status: 409 });
    const activityId = await recordBoardActivity({ boardId: resolved.post.boardId, actorId: user?.id ?? null, type: "POST_UPDATED", postId });
    const snapshot = await readBoardPostEventSnapshot(postId);
    publishBoardEvent(resolved.post.boardId, {
      type: "post.updated",
      entityId: postId,
      sectionId: resolved.post.sectionId,
      actorId: user?.id,
      activityId,
      // 글 작성기는 POST 뒤 첨부 필수 조건을 확정하려고 attachmentCount만 담은 PATCH를 한 번 더
      // 보냅니다. 그 이벤트가 다른 사용자의 드래그 배치를 지우면 안 됩니다. 고정 여부처럼 실제
      // 정렬 의미가 달라진 수정만 서버 배치를 다시 받아야 한다고 명시합니다.
      payload: {
        layoutChanged: parsed.data.isPinned !== undefined && parsed.data.isPinned !== resolved.post.isPinned,
        ...(snapshot ? { post: snapshot.post } : {}),
      },
      delivery: snapshot?.delivery,
    });
    const isMine = user ? resolved.post.authorId === user.id : true;
    return Response.json({
      post: snapshot
        ? { ...snapshot.post, isMine }
        : { ...updated, updatedAt: updated.updatedAt.toISOString() },
    });
  } catch (error) {
    if (error instanceof PostFieldValidationError) return Response.json({ error: error.message, issues: error.issues }, { status: 400 });
    return apiError(error, "게시물을 수정하지 못했습니다.");
  }
}

export async function DELETE(request: Request, { params }: { params: Promise<{ postId: string }> }) {
  try {
    assertSameOrigin(request);
    const user = await getCurrentUser();
    const { postId } = await params;
    const resolved = await postAccess(postId, user);
    if (!resolved) return Response.json({ error: "게시물을 찾을 수 없습니다." }, { status: 404 });
    const allowed = user
      ? canModeratePost({ user, access: resolved.access, postAuthorId: resolved.post.authorId })
      : !!(await resolveGuestPostOwner(resolved.post.boardId, resolved.access.board, resolved.post));
    if (!allowed) return Response.json({ error: "게시물 숨김 권한이 없습니다." }, { status: 403 });
    if (isBoardFrozen(resolved.access)) return Response.json({ error: "동결된 패드에서는 게시물을 삭제할 수 없습니다." }, { status: 409 });
    const overrideActorId = user && !boardScopedEdit(resolved.access.role, user.id, resolved.post.authorId) ? user.id : null;
    const deletedAt = new Date();
    let deletedAttachments: Array<{ id: string; storagePath: string | null; thumbnailPath: string | null }> = [];
    await getPrisma().$transaction(async (transaction) => {
      await transaction.post.update({ where: { id: postId }, data: { deletedAt, version: { increment: 1 } } });
      deletedAttachments = await transaction.attachment.findMany({
        where: { postId },
        select: { id: true, storagePath: true, thumbnailPath: true },
      });
      await transaction.attachment.updateMany({ where: { postId, deletedAt: null }, data: { deletedAt } });
      if (overrideActorId) {
        await transaction.adminAuditLog.create({ data: createAuditLogData({ actorId: overrideActorId, action: "GLOBAL_POST_HIDDEN", entityType: "Post", entityId: postId, reason: "전역 권한으로 게시물 숨김" }) });
      }
    });
    const cleanup = await purgeDeletedPadAttachments(deletedAttachments);
    const activityId = await recordBoardActivity({ boardId: resolved.post.boardId, actorId: user?.id ?? null, type: "POST_DELETED", postId });
    publishBoardEvent(resolved.post.boardId, {
      type: "post.deleted",
      entityId: postId,
      sectionId: resolved.post.sectionId,
      actorId: user?.id,
      activityId,
      delivery: boardPostEventDelivery(resolved.post),
    });
    return Response.json({ ok: true, archived: true, fileCleanupFailed: cleanup.failed });
  } catch (error) {
    return apiError(error, "게시물을 숨기지 못했습니다.");
  }
}
