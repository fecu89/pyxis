import { getBoardMutationAccess } from "@/lib/board/mutation-access";
import { canEditPost, isBoardFrozen, isBoardScopedPostEdit, requireActiveUser } from "@/lib/auth/authorization";
import { createAuditLogData } from "@/lib/auth/audit";
import { adjacentInsertionNeighbors, positionBetween } from "@/lib/board/rank";
import { boardPostEventDelivery } from "@/lib/board/post-snapshot";
import { reorderSchema } from "@/lib/board/validators";
import { apiError, assertSameOrigin } from "@/lib/http";
import { getPrisma } from "@/lib/prisma";
import { publishBoardEvent } from "@/lib/realtime/board-events";

export async function POST(request: Request, { params }: { params: Promise<{ postId: string }> }) {
  try {
    assertSameOrigin(request);
    const user = await requireActiveUser();
    const { postId } = await params;
    const parsed = reorderSchema.safeParse(await request.json());
    if (!parsed.success || !parsed.data.targetSectionId) return Response.json({ error: "정렬 정보가 올바르지 않습니다." }, { status: 400 });
    const prisma = getPrisma();
    const post = await prisma.post.findFirst({ where: { id: postId, deletedAt: null }, select: { boardId: true, authorId: true, guestId: true, status: true } });
    const target = await prisma.section.findFirst({ where: { id: parsed.data.targetSectionId, deletedAt: null }, select: { id: true, boardId: true } });
    if (!post || !target || post.boardId !== target.boardId) return Response.json({ error: "이동할 위치를 찾을 수 없습니다." }, { status: 404 });
    const access = await getBoardMutationAccess(post.boardId, user);
    if (!access || !canEditPost({ user, access, postAuthorId: post.authorId })) return Response.json({ error: "게시물 이동 권한이 없습니다." }, { status: 403 });
    if (isBoardFrozen(access)) return Response.json({ error: "동결된 패드에서는 게시물을 이동할 수 없습니다." }, { status: 409 });

    const moved = await prisma.$transaction(async (tx) => {
      // 글 생성도 같은 Section 행을 잠그므로, 대상 섹션의 위치 계산과 갱신은 서로 겹치지 않습니다.
      await tx.$queryRaw<Array<{ id: string }>>`
        SELECT "id" FROM "Section" WHERE "id" = ${target.id} FOR UPDATE
      `;
      const items = await tx.post.findMany({ where: { sectionId: target.id, deletedAt: null, id: { not: postId } }, orderBy: { position: "asc" }, select: { id: true, position: true } });
      // 클라이언트가 이웃 ID를 만든 뒤 잠금을 기다리는 동안 새 글이 그 사이 또는 목록 끝에
      // 들어올 수 있습니다. 전달받은 두 position의 단순 중간값을 쓰면 새 글과 같은 값이 되므로,
      // 잠금 뒤의 현재 배열에서 유효한 앵커 바로 옆을 다시 찾아 실제로 인접한 두 항목을 씁니다.
      // 앞 앵커가 사라졌으면 뒤 앵커 앞, 둘 다 사라졌으면 현재 목록 끝에 안전하게 붙입니다.
      const { previous, next } = adjacentInsertionNeighbors(items, parsed.data.previousItemId, parsed.data.nextItemId);
      let position = positionBetween(previous?.position ?? null, next?.position ?? null);
      if (position === null) {
        await Promise.all(items.map((item, index) => tx.post.update({ where: { id: item.id }, data: { position: (index + 1) * 1024 } })));
        const previousIndex = previous ? items.findIndex((item) => item.id === previous.id) : -1;
        const nextIndex = next ? items.findIndex((item) => item.id === next.id) : -1;
        position = positionBetween(previousIndex >= 0 ? (previousIndex + 1) * 1024 : null, nextIndex >= 0 ? (nextIndex + 1) * 1024 : null);
      }
      const updated = await tx.post.update({
        where: { id: postId },
        data: { sectionId: target.id, position: position ?? 1024, version: { increment: 1 } },
        select: { sectionId: true, position: true, version: true },
      });
      if (!isBoardScopedPostEdit(access, user.id, post.authorId)) {
        await tx.adminAuditLog.create({ data: createAuditLogData({
          actorId: user.id,
          action: "GLOBAL_POST_UPDATED",
          entityType: "Post",
          entityId: postId,
          after: { sectionId: target.id, operation: "reordered" },
        }) });
      }
      return {
        ...updated,
        previousItemId: previous?.id ?? null,
        nextItemId: next?.id ?? null,
      };
    });
    publishBoardEvent(post.boardId, {
      type: "post.reordered",
      entityId: postId,
      sectionId: target.id,
      actorId: user.id,
      payload: {
        postMove: {
          sectionId: moved.sectionId!,
          position: moved.position,
          version: moved.version,
          previousItemId: moved.previousItemId,
          nextItemId: moved.nextItemId,
        },
      },
      delivery: boardPostEventDelivery(post),
    });
    // SSE보다 응답이 먼저 도착해도 클라이언트가 확정 버전을 알 수 있어야 합니다.
    return Response.json({ ok: true, postMove: moved });
  } catch (error) {
    return apiError(error, "게시물을 이동하지 못했습니다.");
  }
}
