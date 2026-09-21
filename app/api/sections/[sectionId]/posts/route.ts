import { boardAcceptsGuestPosts, canCreatePost, canModeratePosts, canReadEffectiveBoard, determineGuestPostStatus, determineInitialPostStatus, getEffectiveBoardAccess, isBoardFrozen } from "@/lib/auth/authorization";
import { createAuditLogData } from "@/lib/auth/audit";
import { recordBoardActivity } from "@/lib/board/activity";
import { createPostSchema } from "@/lib/board/validators";
import { getCurrentUser } from "@/lib/auth/current-user";
import { readGuestSession } from "@/lib/board/guest-session";
import { getBoardMutationAccess } from "@/lib/board/mutation-access";
import { boardPostCardSelect, readBoardPostEventSnapshot, serializeBoardPost } from "@/lib/board/post-snapshot";
import { apiError, assertSameOrigin } from "@/lib/http";
import { readJsonWithLimit } from "@/lib/http-json";
import { createNotification } from "@/lib/notifications/create";
import { getPrisma } from "@/lib/prisma";
import { publishBoardEvent } from "@/lib/realtime/board-events";
import { assertRateLimit } from "@/lib/security/rate-limit";
import { defaultPostFieldConfig } from "@/lib/post-fields/defaults";
import { parsePostFieldConfig, validatePostFieldSubmission, validateSystemPostFields, PostFieldValidationError } from "@/lib/post-fields/validation";
import { SECTION_POST_PAGE_SIZE } from "@/lib/board/pagination";

export const runtime = "nodejs";
const POST_CREATE_BODY_MAX_BYTES = 512 * 1024;

// 게시물이 페이지당 개수를 넘어도 "더 보기"로 다음 페이지를 이어서 불러옵니다(padupgrade.md 4.1).
export async function GET(request: Request, { params }: { params: Promise<{ sectionId: string }> }) {
  try {
    const { sectionId } = await params;
    const url = new URL(request.url);
    const cursor = url.searchParams.get("cursor") || undefined;
    const limit = Math.min(50, Math.max(1, Number(url.searchParams.get("limit") ?? String(SECTION_POST_PAGE_SIZE)) || SECTION_POST_PAGE_SIZE));

    const prisma = getPrisma();
    const section = await prisma.section.findFirst({ where: { id: sectionId, deletedAt: null, board: { deletedAt: null } }, select: { id: true, boardId: true, board: { select: { postFieldConfig: true, newPostPlacement: true } } } });
    if (!section) return Response.json({ error: "섹션을 찾을 수 없습니다." }, { status: 404 });
    const currentUser = await getCurrentUser();
    const access = await getEffectiveBoardAccess(section.boardId, currentUser);
    if (!access || !canReadEffectiveBoard(currentUser, access)) return Response.json({ error: "게시물을 볼 권한이 없습니다." }, { status: 403 });

    const canManage = Boolean(currentUser && canModeratePosts(currentUser, access));
    // 첫 화면(lib/board/queries.ts)과 같은 규칙입니다. 손님도 자기가 쓴 승인 대기 글은 봅니다.
    const guest = !currentUser && boardAcceptsGuestPosts(access.board) ? await readGuestSession(section.boardId) : null;
    const viewerOwnPost = currentUser ? [{ authorId: currentUser.id }] : guest ? [{ guestId: guest.guestId }] : [];
    const posts = await prisma.post.findMany({
      where: {
        sectionId,
        deletedAt: null,
        ...(canManage ? {} : { OR: [{ status: "PUBLISHED" as const }, ...viewerOwnPost] }),
      },
      orderBy: [{ isPinned: "desc" }, { position: "asc" }, { id: "asc" }],
      take: limit + 1,
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
      select: boardPostCardSelect,
    });
    const hasMore = posts.length > limit;
    const page = hasMore ? posts.slice(0, limit) : posts;

    return Response.json({
      posts: page.map((post) => serializeBoardPost(post, { userId: currentUser?.id ?? null, guestId: guest?.guestId ?? null })),
      nextCursor: hasMore ? page.at(-1)?.id ?? null : null,
    });
  } catch (error) {
    return apiError(error, "게시물을 불러오지 못했습니다.");
  }
}

export async function POST(request: Request, { params }: { params: Promise<{ sectionId: string }> }) {
  try {
    assertSameOrigin(request);
    // 로그인 사용자와 비로그인 손님 둘 다 받습니다. 손님은 공개(PUBLIC) + 방문자 WRITER인
    // 보드에서만 쓸 수 있고, 그 판정은 아래에서 보드 설정을 직접 읽어 합니다 — 쿠키가 권한을
    // 만들지 않습니다(lib/board/guest-session.ts 주석 참고).
    const user = await getCurrentUser();

    // 값비싼 조회 앞에 싼 검사부터 둡니다. 회원은 계정 키로, 손님은 아직 어느 보드인지 모르니
    // 우선 IP로만 한 번 거릅니다. 학교는 한 반이 같은 공인 IP로 나가므로(NAT) 이 단계는
    // 넉넉하게 잡고, 진짜 제한은 손님 세션이 확인된 뒤 아래에서 겁니다.
    if (user) {
      assertRateLimit(request, {
        scope: "post-create",
        userId: user.id,
        windowMs: 60_000,
        maxAttempts: 30,
        message: "글을 너무 빠르게 작성했습니다. 잠시 후 다시 시도해 주세요.",
      });
    } else {
      assertRateLimit(request, {
        scope: "guest-post-create-ip",
        windowMs: 60_000,
        maxAttempts: 60,
        message: "글을 너무 빠르게 작성했습니다. 잠시 후 다시 시도해 주세요.",
      });
    }

    const { sectionId } = await params;
    const parsed = createPostSchema.safeParse(await readJsonWithLimit(request, POST_CREATE_BODY_MAX_BYTES));
    if (!parsed.success) return Response.json({ error: "입력값이 올바르지 않습니다." }, { status: 400 });
    const prisma = getPrisma();
    const section = await prisma.section.findFirst({ where: { id: sectionId, deletedAt: null, board: { deletedAt: null } }, select: { id: true, boardId: true, board: { select: { postFieldConfig: true, newPostPlacement: true } } } });
    if (!section) return Response.json({ error: "섹션을 찾을 수 없습니다." }, { status: 404 });
    const access = await getBoardMutationAccess(section.boardId, user);
    if (!access) return Response.json({ error: "게시물 작성 권한이 없습니다." }, { status: 403 });

    // 손님 경로: 로그인하지 않았다면 보드가 손님 글쓰기를 받는지부터 확인합니다.
    const guest = user ? null : await readGuestSession(section.boardId);
    if (!user) {
      if (!boardAcceptsGuestPosts(access.board)) return Response.json({ error: "게시물 작성 권한이 없습니다." }, { status: 403 });
      if (!guest) return Response.json({ error: "이름을 먼저 입력해 주세요.", code: "GUEST_NAME_REQUIRED" }, { status: 401 });
    } else if (!canCreatePost(user, access)) {
      return Response.json({ error: "게시물 작성 권한이 없습니다." }, { status: 403 });
    }

    // 손님 본 제한: 세션 식별자 기준입니다. IP는 여러 명이 공유하지만 이 키는 브라우저마다
    // 다르므로 한 명이 도배해도 옆자리는 멀쩡합니다. 쿠키를 지우고 새로 받는 우회는 위의
    // IP 단계가 맡습니다.
    if (guest) {
      assertRateLimit(request, {
        scope: "post-create",
        userId: `guest:${guest.guestId}`,
        windowMs: 60_000,
        maxAttempts: 10,
        message: "글을 너무 빠르게 작성했습니다. 잠시 후 다시 시도해 주세요.",
      });
      // 보드 단위 상한. 여러 손님이 한 보드에 몰려 붓는 경우를 막습니다.
      assertRateLimit(request, {
        scope: "guest-post-create-board",
        userId: `board:${section.boardId}`,
        windowMs: 60_000,
        maxAttempts: 200,
        message: "지금 이 패드에 글이 몰리고 있습니다. 잠시 후 다시 시도해 주세요.",
      });
    }
    if (isBoardFrozen(access)) return Response.json({ error: "동결된 패드에는 글을 쓸 수 없습니다." }, { status: 409 });
    const fieldConfig = parsePostFieldConfig(section.board.postFieldConfig ?? defaultPostFieldConfig);
    const systemFields = validateSystemPostFields(fieldConfig, { title: parsed.data.title, body: parsed.data.body, attachmentCount: parsed.data.attachmentCount });
    const customFieldValues = validatePostFieldSubmission(fieldConfig, parsed.data.fieldConfigVersion ?? fieldConfig.version, parsed.data.customFieldValues);
    const placement = section.board.newPostPlacement;
    const boardScopedCreate = !user || (!!access.role && access.role !== "VIEWER" && (access.role !== "MEMBER" || access.board.allowMemberPosting));
    const status = user ? determineInitialPostStatus(user, access) : determineGuestPostStatus(access.board);
    // 전역 권한으로 남의 보드에 쓴 경우에만 감사 로그를 남깁니다.
    const overrideActorId = user && !boardScopedCreate ? user.id : null;
    const post = await prisma.$transaction(async (transaction) => {
      // 같은 섹션의 생성과 재정렬이 모두 이 행을 잠급니다. 위치를 읽고 쓰는 동안 요청을
      // 직렬화해, 동시에 들어온 새 글이 드래그 카드와 같은 position을 받지 않게 합니다.
      await transaction.$queryRaw<Array<{ id: string }>>`
        SELECT "id" FROM "Section" WHERE "id" = ${sectionId} FOR UPDATE
      `;
      const edge = await transaction.post.findFirst({ where: { sectionId, deletedAt: null }, orderBy: { position: placement === "START" ? "asc" : "desc" }, select: { position: true } });
      const position = placement === "START" ? (edge?.position ?? 1024) - 1024 : (edge?.position ?? 0) + 1024;
      const created = await transaction.post.create({
        data: {
          boardId: section.boardId,
          sectionId,
          // 로그인 사용자면 authorId, 손님이면 guestId/guestName. 둘 중 하나만 채웁니다(DB CHECK).
          ...(user ? { authorId: user.id } : { guestId: guest!.guestId, guestName: guest!.name }),
          title: systemFields.title || null,
          body: systemFields.body,
          customFieldValues,
          position,
          status,
        },
        select: { id: true, boardId: true, sectionId: true, title: true, body: true, position: true, version: true, createdAt: true, status: true },
      });
      if (overrideActorId) {
        await transaction.adminAuditLog.create({ data: createAuditLogData({ actorId: overrideActorId, action: "GLOBAL_POST_CREATED", entityType: "Post", entityId: created.id, after: { boardId: section.boardId, sectionId }, reason: "전역 권한으로 게시물 생성" }) });
      }
      return created;
    });
    // 손님은 계정이 없어 actorId가 null입니다(BoardActivity·Notification 모두 nullable).
    const actorId = user?.id ?? null;
    const activityId = await recordBoardActivity({ boardId: section.boardId, actorId, type: "POST_CREATED", postId: post.id });
    const snapshot = await readBoardPostEventSnapshot(post.id);
    publishBoardEvent(section.boardId, {
      type: "post.created",
      entityId: post.id,
      sectionId,
      actorId: actorId ?? undefined,
      activityId,
      payload: snapshot ? { post: snapshot.post } : undefined,
      delivery: snapshot?.delivery,
    });
    if (status === "PENDING") {
      const managers = await prisma.boardMember.findMany({ where: { boardId: section.boardId, role: { in: ["OWNER", "ADMIN"] } }, select: { userId: true } });
      const managerIds = new Set(managers.map((member) => member.userId));
      if (access.board.ownerId) managerIds.add(access.board.ownerId);
      await Promise.all([...managerIds].map((managerId) => createNotification({
        userId: managerId,
        actorId,
        type: "POST_PENDING_REVIEW",
        boardId: section.boardId,
        postId: post.id,
      })));
    }
    return Response.json({ post: { ...post, createdAt: post.createdAt.toISOString() } }, { status: 201 });
  } catch (error) {
    if (error instanceof PostFieldValidationError) return Response.json({ error: error.message, issues: error.issues }, { status: 400 });
    return apiError(error, "게시물을 만들지 못했습니다.");
  }
}
