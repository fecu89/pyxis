import { getBoardMutationAccess } from "@/lib/board/mutation-access";
import { canReact, isBoardFrozen, requireActiveUser, type AuthorizationUser } from "@/lib/auth/authorization";
import { apiError, assertSameOrigin } from "@/lib/http";
import { createNotification } from "@/lib/notifications/create";
import { getPrisma } from "@/lib/prisma";
import { publishBoardEvent } from "@/lib/realtime/board-events";
import { reactionMutationSchema } from "@/lib/board/validators";
import { parseReactionKey, ReactionValidationError } from "@/lib/reactions/validation";
import type { ReactionCounts, ReactionKey } from "@/lib/reactions/types";

async function context(postId: string, user: AuthorizationUser) {
  const post = await getPrisma().post.findFirst({
    where: { id: postId, deletedAt: null, board: { deletedAt: null }, status: "PUBLISHED" },
    select: { boardId: true, authorId: true },
  });
  if (!post) return null;
  const access = await getBoardMutationAccess(post.boardId, user);
  if (!access || !canReact(user, access) || isBoardFrozen(access)) return null;
  return { post, access };
}

async function parseMutation(request: Request, activeFallback: boolean) {
  const raw = await request.json().catch(() => ({ key: "LIKE", active: activeFallback }));
  const parsed = reactionMutationSchema.safeParse(raw);
  if (!parsed.success) throw new ReactionValidationError("반응 요청 형식이 올바르지 않습니다.");
  return { key: parseReactionKey(parsed.data.key), active: parsed.data.active };
}

async function updateReaction(postId: string, user: AuthorizationUser, key: ReactionKey, active: boolean) {
  const resolved = await context(postId, user);
  if (!resolved) return null;
  const prisma = getPrisma();
  const created = await prisma.$transaction(async (tx) => {
    const existing = await tx.reaction.findUnique({
      where: { postId_userId_key: { postId, userId: user.id, key } },
      select: { postId: true },
    });
    if (active) {
      if (resolved.access.board.reactionPolicy === "SINGLE") {
        await tx.reaction.deleteMany({ where: { postId, userId: user.id, key: { not: key } } });
      }
      await tx.reaction.upsert({
        where: { postId_userId_key: { postId, userId: user.id, key } },
        update: {},
        create: { postId, userId: user.id, key },
      });
    } else {
      await tx.reaction.deleteMany({ where: { postId, userId: user.id, key } });
    }
    return active && !existing;
  });

  if (created) {
    // 손님 글은 알릴 계정이 없습니다.
    if (resolved.post.authorId) await createNotification({
      userId: resolved.post.authorId,
      actorId: user.id,
      type: "REACTION_ON_POST",
      boardId: resolved.post.boardId,
      postId,
    });
  }

  const [groups, viewerRows] = await Promise.all([
    prisma.reaction.groupBy({ by: ["key"], where: { postId }, _count: { _all: true } }),
    prisma.reaction.findMany({ where: { postId, userId: user.id }, select: { key: true } }),
  ]);
  const reactionCounts: ReactionCounts = {};
  for (const group of groups) {
    try {
      reactionCounts[parseReactionKey(group.key)] = group._count._all;
    } catch {
      continue;
    }
  }
  const viewerReactions = viewerRows.flatMap((row) => {
    try {
      return [parseReactionKey(row.key)];
    } catch {
      return [];
    }
  });
  const reactionCount = Object.values(reactionCounts).reduce<number>((sum, count) => sum + (count ?? 0), 0);
  publishBoardEvent(resolved.post.boardId, {
    type: "reaction.changed",
    entityId: postId,
    postId,
    actorId: user.id,
    payload: { reactionCount, reactionCounts, actorReactions: viewerReactions },
  });
  return { reactionCount, reactionCounts, viewerReactions };
}

export async function PUT(request: Request, { params }: { params: Promise<{ postId: string }> }) {
  try {
    assertSameOrigin(request);
    const user = await requireActiveUser();
    const { postId } = await params;
    const mutation = await parseMutation(request, true);
    const result = await updateReaction(postId, user, mutation.key, mutation.active);
    if (!result) return Response.json({ error: "반응 권한이 없습니다." }, { status: 403 });
    return Response.json({ ok: true, ...result });
  } catch (error) {
    if (error instanceof ReactionValidationError) return Response.json({ error: error.message }, { status: 400 });
    return apiError(error, "반응을 반영하지 못했습니다.");
  }
}

export async function DELETE(request: Request, { params }: { params: Promise<{ postId: string }> }) {
  try {
    assertSameOrigin(request);
    const user = await requireActiveUser();
    const { postId } = await params;
    const rawKey = new URL(request.url).searchParams.get("key") ?? "LIKE";
    const result = await updateReaction(postId, user, parseReactionKey(rawKey), false);
    if (!result) return Response.json({ error: "반응 권한이 없습니다." }, { status: 403 });
    return Response.json({ ok: true, ...result });
  } catch (error) {
    if (error instanceof ReactionValidationError) return Response.json({ error: error.message }, { status: 400 });
    return apiError(error, "반응을 반영하지 못했습니다.");
  }
}
