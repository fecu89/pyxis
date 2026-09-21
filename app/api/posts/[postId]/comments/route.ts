import { boardAcceptsGuestComments, canComment, canModeratePosts, canReadEffectiveBoard, getEffectiveBoardAccess, isBoardFrozen, isBoardScopedCommentCreate } from "@/lib/auth/authorization";
import { getBoardMutationAccess } from "@/lib/board/mutation-access";
import { createAuditLogData } from "@/lib/auth/audit";
import { getCurrentUser } from "@/lib/auth/current-user";
import { recordBoardActivity } from "@/lib/board/activity";
import { readGuestSession } from "@/lib/board/guest-session";
import { isPostAuthor, toCommentAuthorDTO } from "@/lib/board/post-author";
import { createCommentSchema } from "@/lib/board/validators";
import { validateCommentMentionUserIds, CommentMentionValidationError } from "@/lib/comments/mentions";
import { apiError, assertSameOrigin } from "@/lib/http";
import { readJsonWithLimit } from "@/lib/http-json";
import { createNotification } from "@/lib/notifications/create";
import { getPrisma } from "@/lib/prisma";
import { publishBoardEvent } from "@/lib/realtime/board-events";
import { assertRateLimit } from "@/lib/security/rate-limit";

const commentSelect = {
  id: true,
  body: true,
  parentId: true,
  createdAt: true,
  updatedAt: true,
  author: { select: { id: true, nameEncrypted: true, imageEncrypted: true, status: true } },
  // 손님 댓글은 author가 null이라 표시 이름을 함께 읽습니다. guestId는 소유 판정에만 쓰고
  // 응답에는 넣지 않습니다 — 내리면 남의 손님 신분을 그대로 알게 됩니다.
  guestName: true,
  guestId: true,
  authorId: true,
  mentions: { select: { userId: true } },
  attachments: {
    where: { deletedAt: null },
    orderBy: { sortOrder: "asc" },
    select: { id: true, type: true, originalName: true, mimeType: true, fileSize: true, width: true, height: true, altText: true, caption: true, externalUrl: true, previewImageUrl: true },
  },
} as const;

const COMMENT_PAGE_SIZE = 20;
const COMMENT_BODY_MAX_BYTES = 64 * 1024;

async function findPost(postId: string) {
  return getPrisma().post.findFirst({
    where: { id: postId, deletedAt: null, board: { deletedAt: null } },
    select: { id: true, boardId: true, authorId: true, status: true },
  });
}

function serializeComment(
  comment: {
    id: string;
    body: string;
    parentId: string | null;
    createdAt: Date;
    updatedAt: Date;
    authorId: string | null;
    guestId: string | null;
    guestName: string | null;
    author: { id: string; nameEncrypted: string | null; imageEncrypted: string | null; status: "ACTIVE" | "SUSPENDED" | "DELETED" } | null;
    mentions: { userId: string }[];
    attachments: unknown[];
  },
  viewer: { userId: string | null; guestId: string | null },
) {
  const { guestId, authorId, mentions, ...rest } = comment;
  return {
    ...rest,
    author: toCommentAuthorDTO(comment),
    // 손님 식별자를 내리지 않으므로 "내 댓글인가"는 서버가 판정해 내려보냅니다.
    isMine: isPostAuthor({ authorId, guestId }, viewer),
    mentionedUserIds: mentions.map((mention) => mention.userId),
    createdAt: comment.createdAt.toISOString(),
    updatedAt: comment.updatedAt.toISOString(),
  };
}

export async function GET(request: Request, { params }: { params: Promise<{ postId: string }> }) {
  try {
    const { postId } = await params;
    const post = await findPost(postId);
    if (!post) return Response.json({ error: "게시물을 찾을 수 없습니다." }, { status: 404 });
    const currentUser = await getCurrentUser();
    const access = await getEffectiveBoardAccess(post.boardId, currentUser);
    if (!access || !canReadEffectiveBoard(currentUser, access)) return Response.json({ error: "댓글을 볼 권한이 없습니다." }, { status: 403 });
    if (post.status !== "PUBLISHED") {
      const canSeePending = Boolean(currentUser && (currentUser.id === post.authorId || canModeratePosts(currentUser, access)));
      if (!canSeePending) return Response.json({ error: "댓글을 볼 권한이 없습니다." }, { status: 403 });
    }
    const guest = !currentUser ? await readGuestSession(post.boardId) : null;
    const viewer = { userId: currentUser?.id ?? null, guestId: guest?.guestId ?? null };
    const cursor = new URL(request.url).searchParams.get("cursor");
    const prisma = getPrisma();
    // 새 UI는 대댓글을 들여쓰기하지 않고 @멘션 중심의 한 흐름으로 보여줍니다. 기존 parentId는
    // 데이터 호환을 위해 그대로 반환하지만, 모든 댓글을 같은 페이지네이션 단위로 조회해야 삭제된
    // 부모 아래의 옛 답글도 사라지지 않고 최신 멘션 댓글도 첫 화면에 포함됩니다.
    const pageWithExtra = await prisma.comment.findMany({
      where: { postId, deletedAt: null },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      take: COMMENT_PAGE_SIZE + 1,
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
      select: commentSelect,
    });
    const hasMore = pageWithExtra.length > COMMENT_PAGE_SIZE;
    const page = hasMore ? pageWithExtra.slice(0, COMMENT_PAGE_SIZE) : pageWithExtra;
    const comments = [...page].sort((left, right) => (
      left.createdAt.getTime() - right.createdAt.getTime() || left.id.localeCompare(right.id)
    ));
    return Response.json({
      comments: comments.map((comment) => serializeComment(comment, viewer)),
      hasMore,
      nextCursor: hasMore ? page.at(-1)?.id ?? null : null,
    });
  } catch (error) {
    return apiError(error, "댓글을 불러오지 못했습니다.");
  }
}

export async function POST(request: Request, { params }: { params: Promise<{ postId: string }> }) {
  try {
    assertSameOrigin(request);
    const user = await getCurrentUser();
    // 댓글 한 건마다 카운트 재집계·활동 로그·개인 알림·SSE 발행이 따라붙습니다. 수업 중 활발한
    // 토론(분당 몇 건)은 통과하고 스크립트 도배만 걸리는 선입니다. 손님은 보드를 조회하기 전에
    // IP로 먼저 한 번 거릅니다 — 학교는 한 반이 같은 공인 IP로 나가므로 느슨하게 잡습니다.
    if (user) {
      assertRateLimit(request, {
        scope: "comment-create",
        userId: user.id,
        windowMs: 60_000,
        maxAttempts: 30,
        message: "댓글을 너무 빠르게 작성했습니다. 잠시 후 다시 시도해 주세요.",
      });
    } else {
      assertRateLimit(request, {
        scope: "guest-comment-create-ip",
        windowMs: 60_000,
        maxAttempts: 90,
        message: "댓글을 너무 빠르게 작성했습니다. 잠시 후 다시 시도해 주세요.",
      });
    }
    const { postId } = await params;
    const post = await findPost(postId);
    if (!post) return Response.json({ error: "게시물을 찾을 수 없습니다." }, { status: 404 });
    const access = await getBoardMutationAccess(post.boardId, user);
    if (!access) return Response.json({ error: "댓글 작성 권한이 없습니다." }, { status: 403 });

    // 손님 경로: 글쓰기와 같은 문(공개 + 방문자 WRITER)에 보드의 댓글 허용까지 봅니다.
    const guest = user ? null : await readGuestSession(post.boardId);
    if (!user) {
      if (!boardAcceptsGuestComments(access.board)) return Response.json({ error: "댓글 작성 권한이 없습니다." }, { status: 403 });
      if (!guest) return Response.json({ error: "이름을 먼저 입력해 주세요.", code: "GUEST_NAME_REQUIRED" }, { status: 401 });
      assertRateLimit(request, {
        scope: "comment-create",
        userId: `guest:${guest.guestId}`,
        windowMs: 60_000,
        maxAttempts: 15,
        message: "댓글을 너무 빠르게 작성했습니다. 잠시 후 다시 시도해 주세요.",
      });
    } else if (!canComment(user, access)) {
      return Response.json({ error: "댓글 작성 권한이 없습니다." }, { status: 403 });
    }
    if (post.status !== "PUBLISHED") return Response.json({ error: "승인되지 않은 게시물에는 댓글을 달 수 없습니다." }, { status: 409 });
    if (isBoardFrozen(access)) return Response.json({ error: "동결된 패드에는 댓글을 달 수 없습니다." }, { status: 409 });
    const parsed = createCommentSchema.safeParse(await readJsonWithLimit(request, COMMENT_BODY_MAX_BYTES));
    if (!parsed.success) return Response.json({ error: "댓글을 입력해 주세요." }, { status: 400 });
    const prisma = getPrisma();
    if (parsed.data.parentId) {
      const parent = await prisma.comment.findFirst({ where: { id: parsed.data.parentId, postId, deletedAt: null }, select: { id: true } });
      if (!parent) return Response.json({ error: "같은 게시물의 댓글에만 답글을 달 수 있습니다." }, { status: 400 });
    }
    const mentionedUserIds = await validateCommentMentionUserIds({ boardId: post.boardId, postId, mentionedUserIds: parsed.data.mentionedUserIds });
    const comment = await prisma.$transaction(async (tx) => {
      const created = await tx.comment.create({
        data: {
          postId,
          // 로그인 사용자면 authorId, 손님이면 guestId/guestName(DB CHECK로 둘 중 하나만).
          ...(user ? { authorId: user.id } : { guestId: guest!.guestId, guestName: guest!.name }),
          body: parsed.data.body,
          parentId: parsed.data.parentId ?? null,
          mentions: mentionedUserIds.length ? { createMany: { data: mentionedUserIds.map((userId) => ({ userId })) } } : undefined,
        },
        select: commentSelect,
      });
      // 손님은 전역 권한으로 쓰는 게 아니라 감사 로그 대상이 아닙니다.
      if (user && !isBoardScopedCommentCreate(access)) {
        await tx.adminAuditLog.create({ data: createAuditLogData({
          actorId: user.id,
          action: "GLOBAL_POST_CREATED",
          entityType: "Comment",
          entityId: created.id,
          after: { postId },
        }) });
      }
      return created;
    });
    const commentCount = await prisma.comment.count({ where: { postId, deletedAt: null } });
    // 손님은 계정이 없어 actorId가 null입니다(BoardActivity·Notification 모두 nullable).
    const actorId = user?.id ?? null;
    const activityId = await recordBoardActivity({ boardId: post.boardId, actorId, type: "COMMENT_CREATED", postId, commentId: comment.id });
    publishBoardEvent(post.boardId, {
      type: "comment.created",
      entityId: comment.id,
      postId,
      actorId: actorId ?? undefined,
      activityId,
      payload: {
        commentCount,
        comment: {
          id: comment.id,
          body: comment.body,
          createdAt: comment.createdAt.toISOString(),
          attachments: [],
          author: toCommentAuthorDTO(comment),
          isMine: false,
        },
      },
      delivery: { public: true, authorUserId: comment.authorId, authorGuestId: comment.guestId },
    });
    // 손님이 쓴 글(authorId=null)에는 알릴 계정이 없으므로 건너뜁니다.
    if (post.authorId && !mentionedUserIds.includes(post.authorId)) {
      await createNotification({ userId: post.authorId, actorId, type: "POST_COMMENTED", boardId: post.boardId, postId, commentId: comment.id });
    }
    await Promise.all(mentionedUserIds.map((userId) => createNotification({
      userId,
      actorId,
      type: "COMMENT_MENTIONED",
      boardId: post.boardId,
      postId,
      commentId: comment.id,
    })));
    return Response.json({
      comment: serializeComment(comment, { userId: user?.id ?? null, guestId: guest?.guestId ?? null }),
      commentCount,
    }, { status: 201 });
  } catch (error) {
    if (error instanceof CommentMentionValidationError) return Response.json({ error: error.message }, { status: 400 });
    return apiError(error, "댓글을 등록하지 못했습니다.");
  }
}
