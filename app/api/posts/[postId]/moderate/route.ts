import { z } from "zod";
import { canModeratePosts, getEffectiveBoardAccess, requireActiveUser } from "@/lib/auth/authorization";
import { recordBoardActivity } from "@/lib/board/activity";
import { readBoardPostEventSnapshot } from "@/lib/board/post-snapshot";
import { apiError, assertSameOrigin } from "@/lib/http";
import { createNotification } from "@/lib/notifications/create";
import { getPrisma } from "@/lib/prisma";
import { publishBoardEvent } from "@/lib/realtime/board-events";

const schema = z.object({
  action: z.enum(["APPROVE", "REJECT"]),
  reason: z.string().trim().max(500).optional(),
});

export async function POST(request: Request, { params }: { params: Promise<{ postId: string }> }) {
  try {
    assertSameOrigin(request);
    const user = await requireActiveUser();
    const { postId } = await params;
    const parsed = schema.safeParse(await request.json());
    if (!parsed.success) return Response.json({ error: "처리 방법을 확인해 주세요." }, { status: 400 });

    const prisma = getPrisma();
    const post = await prisma.post.findFirst({
      where: { id: postId, status: "PENDING", deletedAt: null },
      select: { id: true, boardId: true, sectionId: true, authorId: true },
    });
    if (!post) return Response.json({ error: "승인 대기 중인 게시물을 찾을 수 없습니다." }, { status: 404 });
    const access = await getEffectiveBoardAccess(post.boardId, user);
    if (!access || !canModeratePosts(user, access)) return Response.json({ error: "게시물을 승인·거절할 권한이 없습니다." }, { status: 403 });

    const status = parsed.data.action === "APPROVE" ? "PUBLISHED" : "REJECTED";
    await prisma.post.update({
      where: { id: post.id },
      data: { status, moderationReason: parsed.data.action === "REJECT" ? (parsed.data.reason ?? null) : null },
    });

    const activityId = await recordBoardActivity({ boardId: post.boardId, actorId: user.id, type: "POST_MODERATED", postId: post.id });
    const snapshot = await readBoardPostEventSnapshot(post.id);
    publishBoardEvent(post.boardId, {
      type: "post.updated",
      entityId: post.id,
      sectionId: post.sectionId,
      actorId: user.id,
      activityId,
      payload: snapshot ? { post: snapshot.post } : undefined,
      delivery: snapshot?.delivery,
    });
    // 손님 글은 알릴 계정이 없습니다. 승인 결과는 화면에서 확인합니다.
    if (post.authorId) await createNotification({
      userId: post.authorId,
      actorId: user.id,
      type: status === "PUBLISHED" ? "POST_APPROVED" : "POST_REJECTED",
      boardId: post.boardId,
      postId: post.id,
    });

    return Response.json({ ok: true, status });
  } catch (error) {
    return apiError(error, "게시물을 처리하지 못했습니다.");
  }
}
