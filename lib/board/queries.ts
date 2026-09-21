import "server-only";

import type { CurrentUser } from "@/lib/auth/current-user";
import { boardAcceptsGuestComments, boardAcceptsGuestPosts, canArchiveBoard, canComment, canCreatePost, canDownloadAttachment, canEditPost, canManageBoardSettings, canModeratePost, canModeratePosts, canReact, canReadEffectiveBoard, hasSystemPermission } from "@/lib/auth/authorization";
import { readGuestSession } from "@/lib/board/guest-session";
import { SECTION_POST_PAGE_SIZE } from "@/lib/board/pagination";
import { boardPostCardSelect, serializeBoardPost } from "@/lib/board/post-snapshot";
import { hasVerifiedBoardPassword } from "@/lib/board/board-password";
import { getPrisma } from "@/lib/prisma";
import { PAD_TRASH_RETENTION_MS } from "@/lib/board/trash-policy";
import { getBoardAccessBySlug } from "@/lib/board/permissions";
import { decryptUserLoginIdentifier, toPublicAuthorDTO, toPublicOwnerDTO } from "@/lib/users/repository";
import { maskLoginIdentifier } from "@/lib/security/pii-crypto";
import { defaultPostFieldConfig } from "@/lib/post-fields/defaults";
import { parsePostFieldConfig } from "@/lib/post-fields/validation";

const publicUserSelect = { id: true, nameEncrypted: true, imageEncrypted: true } as const;
export const MEMBER_PREVIEW_LIMIT = 200;
export const DASHBOARD_BOARD_PAGE_SIZE = 48;

function resolvedFieldConfig(value: unknown) {
  try {
    return parsePostFieldConfig(value ?? defaultPostFieldConfig);
  } catch {
    return defaultPostFieldConfig;
  }
}

const homeBoardSelect = {
  id: true,
  slug: true,
  title: true,
  description: true,
  backgroundImageUrl: true,
  discoveryScope: true,
  attachmentDownloadPolicy: true,
  isTemplate: true,
  // 목록 카드에서 교과목을 바로 바꿀 수 있게 싣습니다(DashboardBoard에만 노출).
  subjectId: true,
  updatedAt: true,
  owner: { select: { ...publicUserSelect, role: true } },
  _count: { select: { sections: { where: { deletedAt: null } }, posts: { where: { deletedAt: null } } } },
} as const;

export async function getHomeData(user: CurrentUser | null, options: { page?: number; pageSize?: number; includeArchived?: boolean } = {}) {
  const prisma = getPrisma();
  const page = Math.max(1, options.page ?? 1);
  const pageSize = options.pageSize;
  const includeArchived = options.includeArchived ?? true;
  const myBoardsWhere = user ? { deletedAt: null, OR: [{ ownerId: user.id }, { members: { some: { userId: user.id } } }] } : null;
  // 소유 한도와 달리 멤버십에는 상한이 없습니다. 내 패드 첫 화면은 page/pageSize를 넘겨 실제
  // skip/take로 자르고, 폴더·검색처럼 전체 집합이 꼭 필요한 기존 호출만 옵션 없이 사용합니다.
  const [myBoards, pagedTotalCount, archivedBoards] = user && myBoardsWhere
    ? await Promise.all([
      prisma.board.findMany({
        where: myBoardsWhere,
        orderBy: { updatedAt: "desc" },
        ...(pageSize ? { skip: (page - 1) * pageSize, take: pageSize } : {}),
        select: homeBoardSelect,
      }),
      pageSize ? prisma.board.count({ where: myBoardsWhere }) : Promise.resolve(null),
      includeArchived ? prisma.board.findMany({
        where: { ownerId: user.id, deletedAt: { not: null } },
        orderBy: { deletedAt: "desc" },
        select: { ...homeBoardSelect, deletedAt: true },
      }) : Promise.resolve([]),
    ])
    : [[], 0, []] as const;

  const serialize = (board: (typeof myBoards)[number]) => ({
    ...board,
    owner: toPublicOwnerDTO(board.owner),
    ownerRole: board.owner?.role ?? null,
    updatedAt: board.updatedAt.toISOString(),
  });
  return {
    myBoards: myBoards.map(serialize),
    myBoardsTotalCount: pagedTotalCount ?? myBoards.length,
    myBoardsPage: page,
    myBoardsPageSize: pageSize ?? Math.max(1, myBoards.length),
    archivedBoards: archivedBoards.map((board) => {
      const restoreUntil = board.deletedAt!.getTime() + PAD_TRASH_RETENTION_MS;
      return {
        ...board,
        owner: toPublicOwnerDTO(board.owner),
        updatedAt: board.updatedAt.toISOString(),
        deletedAt: board.deletedAt!.toISOString(),
        restorable: restoreUntil > Date.now(),
        remainingDays: Math.max(0, Math.ceil((restoreUntil - Date.now()) / 86_400_000)),
      };
    }),
  };
}

// 관리자 센터 "전체 패드" 탭 전용입니다. VIEW_ALL_BOARDS 권한자가 플랫폼의 모든 패드(또는
// 보관된 패드)를 훑어볼 때 쓰며, getHomeData와 달리 진짜 skip/take + count 페이지네이션이라
// 패드 수가 아무리 많아도 한 페이지 분량만 가져옵니다.
export async function getAdminBoardPage({ page, pageSize, search, includeArchived, ownerLoginIdentifierLookup, updatedFrom, updatedTo, sortBy = "updatedAt", sortDir = "desc" }: {
  page: number;
  pageSize: number;
  search?: string;
  includeArchived: boolean;
  ownerLoginIdentifierLookup?: string;
  updatedFrom?: Date;
  updatedTo?: Date;
  sortBy?: "title" | "updatedAt" | "sections" | "posts";
  sortDir?: "asc" | "desc";
}) {
  const prisma = getPrisma();
  const where = {
    deletedAt: includeArchived ? { not: null } : null,
    ...(search ? { title: { contains: search, mode: "insensitive" as const } } : {}),
    ...(ownerLoginIdentifierLookup ? { owner: { loginIdentifierLookup: ownerLoginIdentifierLookup } } : {}),
    ...((updatedFrom || updatedTo) ? { updatedAt: { ...(updatedFrom ? { gte: updatedFrom } : {}), ...(updatedTo ? { lte: updatedTo } : {}) } } : {}),
  };
  // 보관된 패드를 볼 때는 항상 보관일(deletedAt) 기준으로 정렬합니다 — 활성 패드용 정렬
  // 기준(제목·수정일·섹션·글 수)은 그대로 두되, 보관함에서는 "언제 보관됐는지"가 더 중요합니다.
  const orderBy = includeArchived
    ? { deletedAt: sortDir }
    : sortBy === "title" ? { title: sortDir }
      : sortBy === "sections" ? { sections: { _count: sortDir } }
        : sortBy === "posts" ? { posts: { _count: sortDir } }
          : { updatedAt: sortDir };
  const [totalCount, boards] = await Promise.all([
    prisma.board.count({ where }),
    prisma.board.findMany({
      where,
      orderBy,
      skip: (page - 1) * pageSize,
      take: pageSize,
      select: { ...homeBoardSelect, deletedAt: true },
    }),
  ]);
  return {
    boards: boards.map((board) => ({
      ...board,
      owner: toPublicOwnerDTO(board.owner),
      ownerRole: board.owner?.role ?? null,
      updatedAt: board.updatedAt.toISOString(),
      deletedAt: board.deletedAt ? board.deletedAt.toISOString() : null,
    })),
    totalCount,
    page,
    pageSize,
  };
}

export async function getBoardPageData(
  slug: string,
  currentUser: CurrentUser | null,
  options: { focusPostId?: string; allPosts?: boolean } = {},
) {
  const prisma = getPrisma();
  const access = await getBoardAccessBySlug(slug, currentUser?.id ?? null);
  if (!access) return { status: "not-found" } as const;
  if (!canReadEffectiveBoard(currentUser, access)) {
    if (!currentUser) return { status: "login-required" } as const;
    const accessRequest = await prisma.boardAccessRequest.findUnique({
      where: { boardId_userId: { boardId: access.board.id, userId: currentUser.id } },
      select: { status: true },
    });
    return {
      status: "access-required" as const,
      data: {
        boardId: access.board.id,
        boardTitle: access.board.title,
        ownerName: toPublicOwnerDTO(access.board.owner).name,
        initialRequestStatus: accessRequest?.status ?? null,
      },
    };
  }
  // 비밀번호 보호는 실제 멤버·전역 관리자에게는 적용하지 않고, 방문자 권한으로 들어온 사람에게만 요구합니다.
  if (access.role === null) {
    const isAdminOverride = Boolean(currentUser && hasSystemPermission(currentUser, "VIEW_ALL_BOARDS"));
    if (!isAdminOverride && access.board.passwordHash && !(await hasVerifiedBoardPassword(access.board.id, access.board.passwordHash))) {
      return {
        status: "password-required" as const,
        data: { boardId: access.board.id, boardTitle: access.board.title },
      };
    }
  }

  const canManageBoard = Boolean(currentUser && canManageBoardSettings(currentUser, access));
  // 비로그인 방문자라면 이 보드의 손님 신분을 함께 읽습니다. 자기가 쓴 글(승인 대기 포함)을
  // 자기 화면에서는 볼 수 있어야 하고, 수정·삭제 버튼도 자기 글에만 보여야 합니다.
  const guestWriteOpen = boardAcceptsGuestPosts(access.board);
  const guest = !currentUser && guestWriteOpen ? await readGuestSession(access.board.id) : null;
  const viewerOwnPost = currentUser
    ? [{ authorId: currentUser.id }]
    : guest
      ? [{ guestId: guest.guestId }]
      : [];

  const [board, favorite] = await Promise.all([
    prisma.board.findUnique({
      where: { id: access.board.id },
      select: {
      id: true,
      slug: true,
      title: true,
      description: true,
      discoveryScope: true,
      visitorPermission: true,
      loginRequired: true,
      passwordHash: true,
      state: true,
      moderationMode: true,
      guestPostsRequireApproval: true,
      freezeAt: true,
      layout: true,
      sortMode: true,
      newPostPlacement: true,
      cardSize: true,
      font: true,
      backgroundColor: true,
      backgroundImageUrl: true,
      accentColor: true,
      showAuthor: true,
      showTimestamp: true,
      reactionPolicy: true,
      attachmentDownloadPolicy: true,
      postFieldConfig: true,
      allowComments: true,
      allowReactions: true,
      allowMemberPosting: true,
      allowMemberFileUpload: true,
      owner: { select: publicUserSelect },
      // 페이지 로드에는 아바타 미리보기(4명)와 멘션 자동완성 정도만 필요한데, take 없이 매
      // 방문마다 전원의 이름·이미지를 복호화(AES-GCM)하고 있었습니다. 실제 멤버 관리(역할
      // 변경·제거)는 이 배열이 아니라 설정 패널이 열릴 때 GET /api/boards/[boardId]/members로
      // 전체를 따로 불러옵니다(pad-settings-tabs.tsx).
      members: {
        where: { user: { status: { not: "DELETED" } } },
        orderBy: { joinedAt: "asc" },
        take: MEMBER_PREVIEW_LIMIT,
        select: {
          role: true,
          user: { select: { ...publicUserSelect, loginIdentifierEncrypted: true } },
        },
      },
      _count: {
        select: {
          members: { where: { user: { status: { not: "DELETED" } } } },
        },
      },
      sections: {
        where: { deletedAt: null },
        orderBy: { position: "asc" },
        select: {
          id: true,
          title: true,
          description: true,
          position: true,
          version: true,
          posts: {
            where: {
              deletedAt: null,
              ...(options.focusPostId ? { id: options.focusPostId } : {}),
              ...(canManageBoard ? {} : { OR: [{ status: "PUBLISHED" as const }, ...viewerOwnPost] }),
            },
            orderBy: [{ isPinned: "desc" }, { position: "asc" }, { id: "asc" }],
            // 보드가 오래 운영돼도 모든 카드·첨부·댓글을 HTML/RSC payload에 한꺼번에 싣지
            // 않습니다. 섹션별 첫 30개만 보내고 나머지는 기존 페이지 API로 이어 받습니다.
            ...(options.focusPostId
              ? { take: 1 }
              : options.allPosts
                ? {}
                : { take: SECTION_POST_PAGE_SIZE + 1 }),
            select: boardPostCardSelect,
          },
          _count: {
            select: {
              posts: canManageBoard
                ? { where: { deletedAt: null } }
                : { where: { deletedAt: null, OR: [{ status: "PUBLISHED" as const }, ...viewerOwnPost] } },
            },
          },
        },
      },
      },
    }),
    currentUser
      ? prisma.boardFavorite.findUnique({ where: { boardId_userId: { boardId: access.board.id, userId: currentUser.id } }, select: { boardId: true } })
      : Promise.resolve(null),
  ]);
  if (!board) return { status: "not-found" } as const;
  const { passwordHash, _count, ...boardWithoutHash } = board;

  return {
    status: "ready" as const,
    data: {
      board: {
        ...boardWithoutHash,
        hasPassword: Boolean(passwordHash),
        postFieldConfig: resolvedFieldConfig(board.postFieldConfig),
        freezeAt: board.freezeAt ? board.freezeAt.toISOString() : null,
        owner: toPublicOwnerDTO(board.owner),
        memberCount: _count.members,
        members: board.members.map((member) => ({
          role: member.role,
          user: {
            ...toPublicAuthorDTO(member.user),
            loginIdentifier: canManageBoard ? maskLoginIdentifier(decryptUserLoginIdentifier(member.user)) : null,
          },
        })),
        sections: board.sections.map((section) => ({
          id: section.id,
          title: section.title,
          description: section.description,
          position: section.position,
          version: section.version,
          totalPostCount: section._count.posts,
          posts: section.posts
            .slice(0, options.focusPostId ? 1 : options.allPosts ? section.posts.length : SECTION_POST_PAGE_SIZE)
            .map((post) => serializeBoardPost(post, { userId: currentUser?.id ?? null, guestId: guest?.guestId ?? null })),
          nextCursor: !options.focusPostId && !options.allPosts && section.posts.length > SECTION_POST_PAGE_SIZE
            ? section.posts[SECTION_POST_PAGE_SIZE - 1]?.id ?? null
            : null,
        })),
      },
      currentRole: access.role,
      isFavorite: Boolean(favorite),
      initialFrozen: board.state === "FROZEN" || Boolean(board.freezeAt && board.freezeAt.getTime() <= Date.now()),
      viewer: {
        userId: currentUser?.id ?? null,
        guestWriteOpen: !currentUser && guestWriteOpen,
        guestName: guest?.name ?? null,
      },
      capabilities: {
        manageBoard: canManageBoard,
        archiveBoard: Boolean(currentUser && canArchiveBoard(currentUser, access)),
        viewTrash: Boolean(currentUser && (access.role || hasSystemPermission(currentUser, "VIEW_ALL_BOARDS"))),
        // 손님은 보드가 손님 글쓰기를 받고 있으면 쓸 수 있습니다. 이름은 아직 없어도 됩니다 —
        // 쓰기 버튼을 누르는 순간 물어봅니다.
        createPost: currentUser ? canCreatePost(currentUser, access) : guestWriteOpen,
        editAnyPost: Boolean(currentUser && (
          currentUser.role === "SUPER_ADMIN"
          || hasSystemPermission(currentUser, "EDIT_ANY_CONTENT")
          || ["OWNER", "ADMIN", "EDITOR"].includes(access.role ?? "")
        )),
        deleteAnyPost: Boolean(currentUser && canModeratePost({ user: currentUser, access, postAuthorId: null })),
        // 손님도 자기 글은 고칠 수 있습니다. 어느 글이 자기 글인지는 글마다 isMine으로 옵니다.
        editOwnContent: currentUser ? canEditPost({ user: currentUser, access, postAuthorId: currentUser.id }) : guestWriteOpen,
        moderateComments: Boolean(currentUser && (
          currentUser.role === "SUPER_ADMIN"
          || hasSystemPermission(currentUser, "MODERATE_CONTENT")
          || ["OWNER", "ADMIN", "EDITOR"].includes(access.role ?? "")
        )),
        // 손님은 글쓰기가 열린 보드에서, 보드가 댓글을 켜 두었으면 쓸 수 있습니다.
        comment: currentUser ? canComment(currentUser, access) : boardAcceptsGuestComments(access.board),
        react: Boolean(currentUser && canReact(currentUser, access)),
        moderatePosts: Boolean(currentUser && canModeratePosts(currentUser, access)),
        downloadAttachments: canDownloadAttachment(currentUser, access),
      },
    },
  };
}
