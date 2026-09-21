import "server-only";

import type { CurrentUser } from "@/lib/auth/current-user";
import { canCreateBoard, canDownloadAttachment, canManageBoardSettings, canReadEffectiveBoard } from "@/lib/auth/authorization";
import { hasVerifiedBoardPassword } from "@/lib/board/board-password";
import { getBoardAccessBySlug } from "@/lib/board/permissions";
import type { TemplateBoard } from "@/lib/dashboard/types";
import { getPrisma } from "@/lib/prisma";
import { toPublicOwnerDTO } from "@/lib/users/repository";

export async function getCopyLinkData(slug: string, user: CurrentUser | null) {
  if (!user) return { status: "login-required" } as const;
  if (!canCreateBoard(user)) return { status: "create-forbidden" } as const;
  const access = await getBoardAccessBySlug(slug, user.id);
  if (!access) return { status: "not-found" } as const;
  if (!canReadEffectiveBoard(user, access)) return { status: "access-required" } as const;
  if (access.role === null && access.board.passwordHash && !await hasVerifiedBoardPassword(access.board.id, access.board.passwordHash)) {
    return { status: "password-required", boardId: access.board.id } as const;
  }
  const board = await getPrisma().board.findFirst({
    where: { id: access.board.id, deletedAt: null },
    select: {
      id: true,
      slug: true,
      title: true,
      description: true,
      backgroundImageUrl: true,
      discoveryScope: true,
      attachmentDownloadPolicy: true,
      backgroundColor: true,
      accentColor: true,
      isTemplate: true,
      updatedAt: true,
      owner: { select: { id: true, nameEncrypted: true, imageEncrypted: true } },
      _count: { select: { sections: { where: { deletedAt: null } }, posts: { where: { deletedAt: null, status: "PUBLISHED" } } } },
    },
  });
  if (!board) return { status: "not-found" } as const;
  const summary: TemplateBoard = {
    ...board,
    updatedAt: board.updatedAt.toISOString(),
    owner: toPublicOwnerDTO(board.owner),
    isFavorite: Boolean(await getPrisma().boardFavorite.findUnique({ where: { boardId_userId: { boardId: board.id, userId: user.id } }, select: { boardId: true } })),
    canCopyAttachments: canDownloadAttachment(user, access),
    canCopyMembers: canManageBoardSettings(user, access),
    canManageTemplate: canManageBoardSettings(user, access),
  };
  return { status: "ok", board: summary } as const;
}
