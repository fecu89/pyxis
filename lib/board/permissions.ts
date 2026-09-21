import type { BoardMemberRole } from "@/generated/prisma/client";
import { getPrisma } from "@/lib/prisma";

type BoardLookup = { id: string } | { slug: string };

async function findBoardAccess(lookup: BoardLookup, userId: string | null) {
  const board = await getPrisma().board.findFirst({
    where: { ...lookup, deletedAt: null },
    select: {
      id: true,
      ownerId: true,
      discoveryScope: true,
      visitorPermission: true,
      loginRequired: true,
      passwordHash: true,
      state: true,
      moderationMode: true,
      freezeAt: true,
      title: true,
      owner: { select: { id: true, nameEncrypted: true, imageEncrypted: true, role: true } },
      allowMemberPosting: true,
      // 손님 글의 승인 정책. 글 작성 API가 최초 상태를 정할 때 읽습니다.
      guestPostsRequireApproval: true,
      allowMemberFileUpload: true,
      allowComments: true,
      allowReactions: true,
      reactionPolicy: true,
      attachmentDownloadPolicy: true,
      members: {
        where: { userId: userId ?? "" },
        take: 1,
        select: { role: true },
      },
    },
  });
  if (!board) return null;

  const { members, ...boardAccess } = board;
  const isOwner = userId !== null && board.ownerId === userId;
  const role: BoardMemberRole | null = isOwner ? "OWNER" : members.at(0)?.role ?? null;
  return { board: boardAccess, role, isOwner };
}

export function getBoardAccess(boardId: string, userId: string | null) {
  return findBoardAccess({ id: boardId }, userId);
}

export function getBoardAccessBySlug(slug: string, userId: string | null) {
  return findBoardAccess({ slug }, userId);
}

export async function getArchivedBoardAccess(boardId: string, userId: string) {
  const board = await getPrisma().board.findFirst({
    where: { id: boardId, deletedAt: { not: null } },
    select: {
      id: true,
      ownerId: true,
      discoveryScope: true,
      visitorPermission: true,
      loginRequired: true,
      passwordHash: true,
      state: true,
      moderationMode: true,
      freezeAt: true,
      title: true,
      owner: { select: { id: true, nameEncrypted: true, imageEncrypted: true, role: true } },
      allowMemberPosting: true,
      // 손님 글의 승인 정책. 글 작성 API가 최초 상태를 정할 때 읽습니다.
      guestPostsRequireApproval: true,
      allowMemberFileUpload: true,
      allowComments: true,
      allowReactions: true,
      reactionPolicy: true,
      attachmentDownloadPolicy: true,
      deletedAt: true,
      members: { where: { userId }, take: 1, select: { role: true } },
    },
  });
  if (!board) return null;
  const { members, ...boardAccess } = board;
  const isOwner = board.ownerId === userId;
  const role: BoardMemberRole | null = isOwner ? "OWNER" : members.at(0)?.role ?? null;
  return { board: boardAccess, role, isOwner };
}
