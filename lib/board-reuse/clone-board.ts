import "server-only";

import { randomUUID } from "node:crypto";
import { copyFile, mkdir, rm, stat } from "node:fs/promises";
import path from "node:path";
import { Prisma, type BoardMemberRole } from "@/generated/prisma/client";
import type { CurrentUser } from "@/lib/auth/current-user";
import { canAssignBoardRole, canCreateBoard, canDownloadAttachment, canManageBoardSettings, canReadEffectiveBoard } from "@/lib/auth/authorization";
import { hasVerifiedBoardPassword } from "@/lib/board/board-password";
import { createActivity } from "@/lib/activity/ensure";
import { assertCanOwnAnotherBoard, BoardOwnershipLimitError } from "@/lib/board/ownership-limit";
import { getBoardAccess } from "@/lib/board/permissions";
import type { CloneBoardOptions } from "@/lib/board-reuse/validators";
import { removeStoredAttachmentFiles, type StoredAttachmentFiles } from "@/lib/files/cleanup";
import { createStoredFilename } from "@/lib/files/filename";
import { createPostUploadDirectory, getBoardBackgroundPath, getBoardUploadDirectory, getUploadRoot, resolveStoredFile, toStoragePath } from "@/lib/files/paths";
import { getPrisma } from "@/lib/prisma";

const SETTINGS_SELECT = {
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
  moderationMode: true,
  allowComments: true,
  allowReactions: true,
  allowMemberPosting: true,
  allowMemberFileUpload: true,
} as const;

export class BoardReuseError extends Error {
  constructor(message: string, public readonly status: number) {
    super(message);
    this.name = "BoardReuseError";
  }
}

function slugBase(title: string) {
  return title.toLocaleLowerCase("ko")
    .replace(/[^a-z0-9가-힣]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 36) || "board";
}

async function createAvailableSlug(title: string) {
  const prisma = getPrisma();
  const base = slugBase(title);
  for (let attempt = 0; attempt < 8; attempt += 1) {
    const slug = `${base}-${randomUUID().slice(0, 6)}`;
    if (!await prisma.board.findUnique({ where: { slug }, select: { id: true } })) return slug;
  }
  throw new BoardReuseError("복제 패드 주소를 만들지 못했습니다. 다시 시도해 주세요.", 409);
}

function jsonInput(value: Prisma.JsonValue | null) {
  return value === null ? Prisma.JsonNull : value as Prisma.InputJsonValue;
}

function copiedMemberRole(userRole: "SUPER_ADMIN" | "ADMIN" | "TEACHER" | "STUDENT", role: BoardMemberRole) {
  if (role === "OWNER") return null;
  return canAssignBoardRole(userRole, role) ? role : "MEMBER";
}

async function copyStoredAttachment(args: {
  source: {
    type: "IMAGE" | "PDF" | "DOCUMENT" | "VIDEO" | "AUDIO" | "FILE" | "LINK";
    originalName: string;
    storedName: string | null;
    storagePath: string | null;
    mimeType: string;
    fileSize: number;
    width: number | null;
    height: number | null;
    altText: string | null;
    caption: string | null;
    externalUrl: string | null;
    previewImageUrl: string | null;
    thumbnailPath: string | null;
    sortOrder: number;
  };
  targetBoardId: string;
  targetPostId: string;
  targetUserId: string;
  stagedFiles: StoredAttachmentFiles[];
}): Promise<Prisma.AttachmentCreateManyInput> {
  const { source, targetBoardId, targetPostId, targetUserId, stagedFiles } = args;
  if (source.type === "LINK") {
    return {
      id: randomUUID(),
      postId: targetPostId,
      uploaderId: targetUserId,
      type: source.type,
      originalName: source.originalName,
      storedName: null,
      storagePath: null,
      mimeType: source.mimeType,
      fileSize: source.fileSize,
      width: source.width,
      height: source.height,
      altText: source.altText,
      caption: source.caption,
      externalUrl: source.externalUrl,
      previewImageUrl: source.previewImageUrl,
      thumbnailPath: null,
      sortOrder: source.sortOrder,
    };
  }
  if (!source.storedName || !source.storagePath) {
    throw new BoardReuseError(`첨부파일 ${source.originalName}의 저장 정보를 찾을 수 없습니다.`, 409);
  }

  const extension = path.extname(source.storedName);
  const { baseName, storedName } = createStoredFilename(extension);
  const directory = createPostUploadDirectory(targetBoardId, targetPostId);
  await mkdir(/* turbopackIgnore: true */ directory, { recursive: true });
  const destination = path.join(/* turbopackIgnore: true */ directory, storedName);
  await copyFile(/* turbopackIgnore: true */ resolveStoredFile(source.storagePath), destination);
  const staged: StoredAttachmentFiles = { storagePath: toStoragePath(destination), thumbnailPath: null };
  stagedFiles.push(staged);

  if (source.thumbnailPath) {
    const thumbnailDirectory = path.join(/* turbopackIgnore: true */ directory, "thumbnails");
    await mkdir(/* turbopackIgnore: true */ thumbnailDirectory, { recursive: true });
    const thumbnailDestination = path.join(/* turbopackIgnore: true */ thumbnailDirectory, `${baseName}.webp`);
    await copyFile(/* turbopackIgnore: true */ resolveStoredFile(source.thumbnailPath), thumbnailDestination);
    staged.thumbnailPath = toStoragePath(thumbnailDestination);
  }

  return {
    id: randomUUID(),
    postId: targetPostId,
    uploaderId: targetUserId,
    type: source.type,
    originalName: source.originalName,
    storedName,
    storagePath: staged.storagePath,
    mimeType: source.mimeType,
    fileSize: source.fileSize,
    width: source.width,
    height: source.height,
    altText: source.altText,
    caption: source.caption,
    externalUrl: null,
    previewImageUrl: null,
    thumbnailPath: staged.thumbnailPath,
    sortOrder: source.sortOrder,
  };
}

async function mapWithConcurrency<T, R>(items: T[], concurrency: number, mapper: (item: T) => Promise<R>) {
  const results = new Array<R>(items.length);
  let nextIndex = 0;
  let firstError: unknown = null;
  async function worker() {
    while (nextIndex < items.length && firstError === null) {
      const index = nextIndex;
      nextIndex += 1;
      try {
        results[index] = await mapper(items[index]);
      } catch (error) {
        firstError ??= error;
      }
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, () => worker()));
  if (firstError !== null) throw firstError;
  return results;
}

export async function cloneBoard(sourceBoardId: string, user: CurrentUser, options: CloneBoardOptions) {
  if (!canCreateBoard(user)) throw new BoardReuseError("패드를 복제할 권한이 없습니다.", 403);
  const access = await getBoardAccess(sourceBoardId, user.id);
  if (!access) throw new BoardReuseError("복제할 패드를 찾을 수 없습니다.", 404);
  if (!canReadEffectiveBoard(user, access)) throw new BoardReuseError("이 패드를 복제할 권한이 없습니다.", 403);
  if (access.role === null && access.board.passwordHash && !await hasVerifiedBoardPassword(sourceBoardId, access.board.passwordHash)) {
    throw new BoardReuseError("패드 비밀번호를 확인한 뒤 복제해 주세요.", 403);
  }
  if (options.includeAttachments && !canDownloadAttachment(user, access)) {
    throw new BoardReuseError("첨부 원본 다운로드 권한이 없어 파일을 복제할 수 없습니다.", 403);
  }
  if (options.includeMembers && !canManageBoardSettings(user, access)) {
    throw new BoardReuseError("패드 멤버는 소유자 또는 관리자만 복제할 수 있습니다.", 403);
  }

  const prisma = getPrisma();
  const source = await prisma.board.findFirst({
    where: { id: sourceBoardId, deletedAt: null },
    select: {
      id: true,
      title: true,
      description: true,
      ...SETTINGS_SELECT,
      sections: {
        where: { deletedAt: null },
        orderBy: [{ position: "asc" }, { id: "asc" }],
        select: { id: true, title: true, description: true, position: true },
      },
      posts: {
        where: { deletedAt: null, status: "PUBLISHED" },
        orderBy: [{ position: "asc" }, { id: "asc" }],
        select: {
          id: true,
          sectionId: true,
          title: true,
          body: true,
          bodyFormat: true,
          customFieldValues: true,
          position: true,
          isPinned: true,
          attachments: {
            where: { deletedAt: null, commentId: null },
            orderBy: [{ sortOrder: "asc" }, { id: "asc" }],
            select: {
              type: true,
              originalName: true,
              storedName: true,
              storagePath: true,
              mimeType: true,
              fileSize: true,
              width: true,
              height: true,
              altText: true,
              caption: true,
              externalUrl: true,
              previewImageUrl: true,
              thumbnailPath: true,
              sortOrder: true,
            },
          },
        },
      },
      members: {
        where: { user: { status: "ACTIVE" } },
        select: { userId: true, role: true, user: { select: { role: true } } },
      },
    },
  });
  if (!source) throw new BoardReuseError("복제할 패드를 찾을 수 없습니다.", 404);

  const title = options.title?.trim() || `${source.title} 복사본`;
  const targetBoardId = randomUUID();
  const slug = await createAvailableSlug(title);
  const sectionIdBySource = new Map(source.sections.map((section) => [section.id, randomUUID()]));
  const targetPosts = options.includePosts
    ? source.posts.map((post) => ({ source: post, id: randomUUID() }))
    : [];
  const stagedFiles: StoredAttachmentFiles[] = [];

  try {
    let copiedBackgroundImageUrl: string | null = null;
    if (options.includeSettings && source.backgroundImageUrl) {
      const sourceBackgroundPath = getBoardBackgroundPath(source.id);
      const sourceBackground = await stat(sourceBackgroundPath).catch(() => null);
      if (sourceBackground?.isFile()) {
        await mkdir(/* turbopackIgnore: true */ getBoardUploadDirectory(targetBoardId), { recursive: true });
        await copyFile(/* turbopackIgnore: true */ sourceBackgroundPath, getBoardBackgroundPath(targetBoardId));
        copiedBackgroundImageUrl = `/api/boards/${targetBoardId}/background-image?v=${Date.now()}`;
      }
    }

    const attachmentInputs = options.includeAttachments
      ? await mapWithConcurrency(
          targetPosts.flatMap((post) => post.source.attachments.map((attachment) => ({ attachment, targetPostId: post.id }))),
          4,
          ({ attachment, targetPostId }) => copyStoredAttachment({
            source: attachment,
            targetBoardId,
            targetPostId,
            targetUserId: user.id,
            stagedFiles,
          }),
        )
      : [];

    // activityId는 트랜잭션 안에서 활동을 만든 뒤 붙이므로 여기서는 제외합니다.
    const boardData: Omit<Prisma.BoardUncheckedCreateInput, "activityId"> = {
      id: targetBoardId,
      slug,
      title,
      description: source.description,
      ownerId: user.id,
      discoveryScope: "PRIVATE",
      visitorPermission: "NO_ACCESS",
      loginRequired: true,
      passwordHash: null,
      state: "ACTIVE",
      freezeAt: null,
      isTemplate: false,
      ...(options.includeSettings ? {
        layout: source.layout,
        sortMode: source.sortMode,
        newPostPlacement: source.newPostPlacement,
        cardSize: source.cardSize,
        font: source.font,
        backgroundColor: source.backgroundColor,
        backgroundImageUrl: copiedBackgroundImageUrl,
        accentColor: source.accentColor,
        showAuthor: source.showAuthor,
        showTimestamp: source.showTimestamp,
        reactionPolicy: source.reactionPolicy,
        attachmentDownloadPolicy: source.attachmentDownloadPolicy,
        postFieldConfig: jsonInput(source.postFieldConfig),
        moderationMode: source.moderationMode,
        allowComments: source.allowComments,
        allowReactions: source.allowReactions,
        allowMemberPosting: source.allowMemberPosting,
        allowMemberFileUpload: source.allowMemberFileUpload,
      } : {}),
    };
    const sectionInputs: Prisma.SectionCreateManyInput[] = options.includeSections
      ? source.sections.map((section) => ({
          id: sectionIdBySource.get(section.id) as string,
          boardId: targetBoardId,
          title: section.title,
          description: section.description,
          position: section.position,
        }))
      : [];
    const postInputs: Prisma.PostCreateManyInput[] = targetPosts.map(({ source: post, id }) => ({
      id,
      boardId: targetBoardId,
      sectionId: post.sectionId ? sectionIdBySource.get(post.sectionId) ?? null : null,
      authorId: user.id,
      title: post.title,
      body: post.body,
      bodyFormat: post.bodyFormat,
      status: "PUBLISHED",
      moderationReason: null,
      customFieldValues: jsonInput(post.customFieldValues),
      position: post.position,
      isPinned: post.isPinned,
    }));
    const copiedMembers = options.includeMembers
      ? source.members.flatMap((member) => {
          if (member.userId === user.id) return [];
          const role = copiedMemberRole(member.user.role, member.role);
          return role ? [{ boardId: targetBoardId, userId: member.userId, role }] : [];
        })
      : [];
    const memberInputs: Prisma.BoardMemberCreateManyInput[] = [
      { boardId: targetBoardId, userId: user.id, role: "OWNER" },
      ...copiedMembers,
    ];

    await prisma.$transaction(async (tx) => {
      try {
        await assertCanOwnAnotherBoard(tx, user);
      } catch (error) {
        if (error instanceof BoardOwnershipLimitError) throw new BoardReuseError(error.message, error.status);
        throw error;
      }
      // 복제본도 리포트에 잡혀야 합니다. `/report`는 Activity 한 테이블만 읽으므로,
      // 여기서 빠지면 복제로 만든 패드는 활동 기록에 아예 나타나지 않습니다.
      const activityId = await createActivity(tx, { type: "PAD_BOARD", ownerId: user.id, title });
      await tx.board.create({ data: { ...boardData, activityId } });
      if (sectionInputs.length) await tx.section.createMany({ data: sectionInputs });
      if (postInputs.length) await tx.post.createMany({ data: postInputs });
      if (attachmentInputs.length) await tx.attachment.createMany({ data: attachmentInputs });
      await tx.boardMember.createMany({ data: memberInputs, skipDuplicates: true });
      await tx.boardFollow.createMany({
        data: memberInputs.map((member) => ({ boardId: targetBoardId, userId: member.userId })),
        skipDuplicates: true,
      });
    }, { timeout: 30_000 });

    return {
      id: targetBoardId,
      slug,
      title,
      copied: {
        sections: sectionInputs.length,
        posts: postInputs.length,
        attachments: attachmentInputs.length,
        members: copiedMembers.length,
      },
    };
  } catch (error) {
    // 활동을 지우면 cascade로 보드도 함께 사라집니다(둘 중 하나만 남지 않게).
    await getPrisma().activity.deleteMany({ where: { board: { id: targetBoardId } } }).catch(() => undefined);
    await removeStoredAttachmentFiles(stagedFiles);
    await rm(path.join(/* turbopackIgnore: true */ getUploadRoot(), "boards", targetBoardId), { recursive: true, force: true }).catch(() => undefined);
    throw error;
  }
}
