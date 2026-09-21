import "server-only";

import { cache } from "react";
import type { UserRole } from "@/generated/prisma/client";
import type { CurrentUser } from "@/lib/auth/current-user";
import { hasSystemPermission } from "@/lib/auth/authorization";
import { hasVerifiedBoardPassword } from "@/lib/board/board-password";
import { visitorGrantsPermission } from "@/lib/board/visitor-policy";
import { getHomeData } from "@/lib/board/queries";
import type {
  AccessRequestBoard,
  BoardSummary,
  DashboardBoard,
  DashboardBoardRelation,
  DashboardBoardRole,
  DashboardFolder,
  TemplateBoard,
} from "@/lib/dashboard/types";
import { getPrisma } from "@/lib/prisma";
import { toPublicOwnerDTO } from "@/lib/users/repository";

const publicUserSelect = { id: true, nameEncrypted: true, imageEncrypted: true } as const;
const dashboardBoardSelect = {
  id: true,
  slug: true,
  title: true,
  description: true,
  backgroundImageUrl: true,
  ownerId: true,
  discoveryScope: true,
  visitorPermission: true,
  passwordHash: true,
  attachmentDownloadPolicy: true,
  isTemplate: true,
  subjectId: true,
  updatedAt: true,
  owner: { select: { ...publicUserSelect, role: true } },
  _count: { select: { sections: { where: { deletedAt: null } }, posts: { where: { deletedAt: null } } } },
} as const;

type RawDashboardBoard = {
  id: string;
  subjectId: string | null;
  slug: string;
  title: string;
  description: string | null;
  backgroundImageUrl: string | null;
  ownerId: string | null;
  discoveryScope: "PRIVATE" | "LINK" | "PUBLIC";
  visitorPermission: "NO_ACCESS" | "READER" | "COMMENTER" | "WRITER";
  passwordHash: string | null;
  attachmentDownloadPolicy: "READERS" | "MEMBERS" | "EDITORS" | "DISABLED";
  isTemplate: boolean;
  updatedAt: Date;
  owner: { id: string; nameEncrypted: string | null; imageEncrypted: string | null; role: UserRole } | null;
  _count: { sections: number; posts: number };
};

function serializeBoard(board: RawDashboardBoard): BoardSummary {
  return {
    id: board.id,
    slug: board.slug,
    title: board.title,
    description: board.description,
    backgroundImageUrl: board.backgroundImageUrl,
    discoveryScope: board.discoveryScope,
    attachmentDownloadPolicy: board.attachmentDownloadPolicy,
    isTemplate: board.isTemplate,
    updatedAt: board.updatedAt.toISOString(),
    owner: toPublicOwnerDTO(board.owner),
    _count: board._count,
  };
}

// candidateSummaries 안에서만 쓰는, 소유자 역할까지 포함한 임시 확장 버전입니다. 이 ownerRole은
// canArchive 계산에만 쓰고 최종 응답 객체에는 절대 spread하지 않습니다(공개 API로 새면 안 되는 값).
function serializeBoardWithOwnerRole(board: RawDashboardBoard): BoardSummary & { ownerRole: UserRole | null; subjectId: string | null } {
  // subjectId는 목록 카드가 교과목을 바로 바꿀 때만 쓰므로 공용 BoardSummary가 아니라
  // 여기서 더합니다(보관함·템플릿·접근 요청 카드에는 필요 없습니다).
  return { ...serializeBoard(board), ownerRole: board.owner?.role ?? null, subjectId: board.subjectId };
}

function canManage(user: CurrentUser, role: DashboardBoardRole, isOwner: boolean) {
  return user.role === "SUPER_ADMIN"
    || hasSystemPermission(user, "MANAGE_BOARD_SETTINGS")
    || isOwner
    || role === "OWNER"
    || role === "ADMIN";
}

function canCopyAttachments(user: CurrentUser, role: DashboardBoardRole, policy: BoardSummary["attachmentDownloadPolicy"]) {
  if (user.role === "SUPER_ADMIN" || hasSystemPermission(user, "EDIT_ANY_CONTENT")) return true;
  if (policy === "READERS") return true;
  if (policy === "MEMBERS") return role !== null;
  if (policy === "EDITORS") return role !== null && ["OWNER", "ADMIN", "EDITOR"].includes(role);
  return false;
}

function canWritePosts(
  user: CurrentUser,
  role: DashboardBoardRole,
  access: {
    discoveryScope: "PRIVATE" | "LINK" | "PUBLIC";
    visitorPermission: "NO_ACCESS" | "READER" | "COMMENTER" | "WRITER";
    loginRequired: boolean;
    allowMemberPosting: boolean;
  },
) {
  if (user.role === "SUPER_ADMIN" || hasSystemPermission(user, "CREATE_CONTENT_ANYWHERE")) return true;
  if (role && role !== "VIEWER") return role !== "MEMBER" || access.allowMemberPosting;
  return visitorGrantsPermission(access, "WRITER");
}

function templateSummary(board: DashboardBoard): TemplateBoard {
  return {
    id: board.id,
    slug: board.slug,
    title: board.title,
    description: board.description,
    backgroundImageUrl: board.backgroundImageUrl,
    discoveryScope: board.discoveryScope,
    attachmentDownloadPolicy: board.attachmentDownloadPolicy,
    isTemplate: board.isTemplate,
    updatedAt: board.updatedAt,
    owner: board.owner,
    _count: board._count,
    isFavorite: board.isFavorite,
    canCopyAttachments: board.canCopyAttachments,
    canCopyMembers: board.canCopyMembers,
    canManageTemplate: board.canManageTemplate,
  };
}

// layout.tsx가 사이드바용 recentBoards만 필요해도 page.tsx와 같은 요청 안에서 이 함수를
// 함께 호출하므로, React cache()로 감싸 무거운 조회가 두 번 실행되지 않게 합니다.
export const getDashboardHomeData = cache(async (user: CurrentUser | null, options: { page?: number; pageSize?: number; includeArchived?: boolean } = {}) => {
  const base = await getHomeData(user, options);
  if (!user) {
    return {
      ...base,
      myBoards: [] as DashboardBoard[],
      recentBoards: [] as DashboardBoard[],
      accessRequestBoards: [] as AccessRequestBoard[],
      dashboardFolders: [] as DashboardFolder[],
      templateBoards: [] as TemplateBoard[],
    };
  }

  const prisma = getPrisma();
  const [favoriteRows, rawFolders, visitRows] = await Promise.all([
    prisma.boardFavorite.findMany({ where: { userId: user.id }, orderBy: { createdAt: "desc" }, take: 200, select: { boardId: true } }),
    prisma.dashboardFolder.findMany({
      where: { userId: user.id },
      orderBy: [{ position: "asc" }, { createdAt: "asc" }],
      select: { id: true, name: true, position: true, boards: { orderBy: [{ position: "asc" }, { createdAt: "asc" }], select: { boardId: true } } },
    }),
    prisma.boardVisit.findMany({
      where: { userId: user.id },
      orderBy: { lastVisitedAt: "desc" },
      take: 100,
      select: { boardId: true, lastVisitedAt: true },
    }),
  ]);
  const favoriteIds = new Set(favoriteRows.map((row) => row.boardId));
  const baseBoardIds = new Set(base.myBoards.map((board) => board.id));
  const savedBoardIds = new Set([
    ...favoriteRows.map((row) => row.boardId),
    ...rawFolders.flatMap((folder) => folder.boards.map((item) => item.boardId)),
  ]);
  const candidateIds = new Set([...savedBoardIds, ...visitRows.map((row) => row.boardId)]);
  // 페이지가 지정된 내 패드 화면에서는 현재 페이지 밖의 즐겨찾기·폴더·방문 패드를 다시 전부
  // 합치면 skip/take가 무력화됩니다. 저장한 공개 패드는 전용 즐겨찾기·폴더 화면에서 확인하고,
  // 여기서는 실제 소유·멤버십 페이지 경계를 지킵니다.
  const extraIds = options.pageSize
    ? []
    : Array.from(candidateIds).filter((boardId) => !baseBoardIds.has(boardId));
  const extraCandidates = extraIds.length
    ? await prisma.board.findMany({ where: { id: { in: extraIds }, deletedAt: null }, select: dashboardBoardSelect })
    : [];
  const readableExtras: RawDashboardBoard[] = [];
  for (const board of extraCandidates) {
    if (board.discoveryScope === "PRIVATE") continue;
    if (board.discoveryScope === "PUBLIC" && board.visitorPermission === "NO_ACCESS") continue;
    if (board.passwordHash && !await hasVerifiedBoardPassword(board.id, board.passwordHash)) continue;
    readableExtras.push(board);
  }
  const candidateSummaries = [
    ...base.myBoards,
    ...readableExtras.map(serializeBoardWithOwnerRole),
  ];
  const boardIds = candidateSummaries.map((board) => board.id);
  const [memberships, ownedBoards, boardPermissionRows, accessRequests, publicTemplates] = await Promise.all([
    boardIds.length
      ? prisma.boardMember.findMany({ where: { userId: user.id, boardId: { in: boardIds } }, select: { boardId: true, role: true } })
      : [],
    boardIds.length
      ? prisma.board.findMany({ where: { id: { in: boardIds }, ownerId: user.id }, select: { id: true } })
      : [],
    boardIds.length
      ? prisma.board.findMany({
          where: { id: { in: boardIds } },
          select: { id: true, discoveryScope: true, visitorPermission: true, loginRequired: true, allowMemberPosting: true },
        })
      : [],
    prisma.boardAccessRequest.findMany({
      where: { userId: user.id, status: { in: ["PENDING", "REJECTED"] }, board: { deletedAt: null } },
      orderBy: { updatedAt: "desc" },
      select: {
        status: true,
        updatedAt: true,
        board: {
          select: {
            id: true,
            slug: true,
            title: true,
            description: true,
            backgroundImageUrl: true,
            discoveryScope: true,
            attachmentDownloadPolicy: true,
            isTemplate: true,
            updatedAt: true,
            owner: { select: publicUserSelect },
            _count: { select: { sections: { where: { deletedAt: null } }, posts: { where: { deletedAt: null } } } },
          },
        },
      },
    }),
    prisma.board.findMany({
      where: {
        deletedAt: null,
        isTemplate: true,
        discoveryScope: "PUBLIC",
        visitorPermission: { not: "NO_ACCESS" },
        passwordHash: null,
      },
      orderBy: { updatedAt: "desc" },
      take: 12,
      select: dashboardBoardSelect,
    }),
  ]);

  const membershipByBoard = new Map(memberships.map((membership) => [membership.boardId, membership.role]));
  const permissionByBoard = new Map(boardPermissionRows.map((board) => [board.id, board]));
  const lastSeenByBoard = new Map(visitRows.map((visit) => [visit.boardId, visit.lastVisitedAt.toISOString()]));
  const ownedBoardIds = new Set(ownedBoards.map((board) => board.id));
  const folderIdsByBoard = new Map<string, string[]>();
  rawFolders.forEach((folder) => folder.boards.forEach((item) => {
    const folderIds = folderIdsByBoard.get(item.boardId) ?? [];
    folderIds.push(folder.id);
    folderIdsByBoard.set(item.boardId, folderIds);
  }));
  const accessibleBoards: DashboardBoard[] = candidateSummaries.map(({ ownerRole, ...board }) => {
    const role = (membershipByBoard.get(board.id) ?? null) as DashboardBoardRole;
    const isOwner = ownedBoardIds.has(board.id) || role === "OWNER";
    const relation: DashboardBoardRelation = isOwner
      ? "OWNED"
      : role
        ? "SHARED"
        : baseBoardIds.has(board.id)
          ? "MANAGED"
          : "SAVED";
    const manage = canManage(user, role, isOwner);
    const permission = permissionByBoard.get(board.id) ?? {
      discoveryScope: "PRIVATE" as const,
      visitorPermission: "NO_ACCESS" as const,
      loginRequired: true,
      allowMemberPosting: false,
    };
    // 전체관리자는 모든 패드를, 교사는 학생 소유 패드를 홈 화면 빠른 메뉴에서 바로 보관할 수
    // 있어야 합니다(단, 교사끼리는 서로의 패드를 건드릴 수 없음 — authorization.ts와 동일한 규칙).
    const canArchive = user.role === "SUPER_ADMIN"
      || isOwner
      || (user.role === "TEACHER" && ownerRole === "STUDENT");
    return {
      ...board,
      relation,
      memberRole: role,
      lastViewedAt: lastSeenByBoard.get(board.id) ?? null,
      isFavorite: favoriteIds.has(board.id),
      folderIds: folderIdsByBoard.get(board.id) ?? [],
      canWritePosts: canWritePosts(user, role, permission),
      canCopyAttachments: canCopyAttachments(user, role, board.attachmentDownloadPolicy),
      canCopyMembers: manage,
      canManageTemplate: manage,
      canArchive,
    };
  });
  const myBoards = accessibleBoards.filter((board) => baseBoardIds.has(board.id) || savedBoardIds.has(board.id));
  const dashboardIds = new Set(myBoards.map((board) => board.id));
  const recentBoards = accessibleBoards
    .filter((board) => board.lastViewedAt)
    .sort((left, right) => Date.parse(right.lastViewedAt as string) - Date.parse(left.lastViewedAt as string))
    .slice(0, 6);
  const accessRequestBoards: AccessRequestBoard[] = accessRequests.map((request) => ({
    ...request.board,
    owner: toPublicOwnerDTO(request.board.owner),
    updatedAt: request.board.updatedAt.toISOString(),
    requestStatus: request.status === "PENDING" ? "PENDING" : "REJECTED",
    requestedAt: request.updatedAt.toISOString(),
  }));
  const dashboardFolders: DashboardFolder[] = rawFolders.map((folder) => ({
    id: folder.id,
    name: folder.name,
    position: folder.position,
    boardIds: folder.boards.map((item) => item.boardId).filter((boardId) => dashboardIds.has(boardId)),
  }));

  const templateMap = new Map<string, TemplateBoard>();
  myBoards.filter((board) => board.isTemplate).forEach((board) => templateMap.set(board.id, templateSummary(board)));
  publicTemplates.forEach((raw) => {
    if (templateMap.has(raw.id)) return;
    const summary = serializeBoard(raw);
    const manage = canManage(user, null, raw.ownerId === user.id);
    templateMap.set(raw.id, {
      ...summary,
      isFavorite: favoriteIds.has(raw.id),
      canCopyAttachments: canCopyAttachments(user, null, raw.attachmentDownloadPolicy),
      canCopyMembers: manage,
      canManageTemplate: manage,
    });
  });

  return { ...base, myBoards, recentBoards, accessRequestBoards, dashboardFolders, templateBoards: Array.from(templateMap.values()) };
});
