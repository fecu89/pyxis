import "../lib/load-env";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { cloneBoard } from "../lib/board-reuse/clone-board";
import { getDashboardHomeData } from "../lib/dashboard/queries";
import { removeStoredAttachmentFiles, type StoredAttachmentFiles } from "../lib/files/cleanup";
import { createPostUploadDirectory, getUploadRoot, toStoragePath } from "../lib/files/paths";
import { getPrisma } from "../lib/prisma";
import { getPrivateUserDTO } from "../lib/users/repository";
import { createPadActivity } from "./fixtures";

const cleanupBoardIds: string[] = [];
const cleanupFolderIds: string[] = [];
const cleanupFiles: StoredAttachmentFiles[] = [];

async function main() {
  const prisma = getPrisma();
  const [teacher, student] = await Promise.all([
    prisma.user.findFirst({ where: { status: "ACTIVE", role: { in: ["TEACHER", "SUPER_ADMIN"] } }, select: { id: true } }),
    prisma.user.findFirst({ where: { status: "ACTIVE", role: "STUDENT" }, select: { id: true } }),
  ]);
  assert.ok(teacher && student, "보드 재사용 검증용 교사와 학생이 필요합니다.");
  const teacherDto = await getPrivateUserDTO(teacher.id);
  const studentDto = await getPrivateUserDTO(student.id);
  assert.ok(teacherDto && studentDto);
  const suffix = `${Date.now()}-${randomUUID().slice(0, 6)}`;
  const sourceBoardId = randomUUID();
  const sectionId = randomUUID();
  const publishedPostId = randomUUID();
  const pendingPostId = randomUUID();
  const uploadDirectory = createPostUploadDirectory(sourceBoardId, publishedPostId);
  await mkdir(uploadDirectory, { recursive: true });
  const sourceFilePath = path.join(uploadDirectory, `${randomUUID()}.txt`);
  await writeFile(sourceFilePath, "pyxpad clone verification", "utf8");
  const sourceStoragePath = toStoragePath(sourceFilePath);
  cleanupFiles.push({ storagePath: sourceStoragePath, thumbnailPath: null });

  await prisma.board.create({
    data: {
      id: sourceBoardId,
      slug: `verify-reuse-source-${suffix}`,
      title: "[검증용] 복제 원본",
      description: "복제 회귀 검사",
      ownerId: teacher.id,
      activityId: await createPadActivity(prisma, teacher.id, "[검증용] 복제 원본"),
      backgroundColor: "#eef6f0",
      accentColor: "#2d694e",
      isTemplate: true,
      members: { create: [{ userId: teacher.id, role: "OWNER" }, { userId: student.id, role: "MEMBER" }] },
      sections: { create: { id: sectionId, title: "원본 섹션", position: 1024 } },
      posts: {
        create: [
          {
            id: publishedPostId,
            sectionId,
            authorId: student.id,
            title: "복제할 게시물",
            body: "게시된 내용",
            status: "PUBLISHED",
            position: 1024,
            attachments: {
              create: [
                {
                  uploaderId: student.id,
                  type: "FILE",
                  originalName: "검증_파일.txt",
                  storedName: path.basename(sourceFilePath),
                  storagePath: sourceStoragePath,
                  mimeType: "text/plain",
                  fileSize: 29,
                  sortOrder: 0,
                },
                {
                  uploaderId: student.id,
                  type: "LINK",
                  originalName: "pyxis 링크",
                  storedName: null,
                  storagePath: null,
                  mimeType: "text/uri-list",
                  fileSize: 0,
                  externalUrl: "https://example.com/resource",
                  previewImageUrl: "https://example.com/resource-card.jpg",
                  sortOrder: 1,
                },
              ],
            },
          },
          {
            id: pendingPostId,
            sectionId,
            authorId: student.id,
            title: "복제하면 안 되는 승인 대기 글",
            body: "승인 대기",
            status: "PENDING",
            position: 2048,
          },
        ],
      },
      follows: { create: [{ userId: teacher.id }, { userId: student.id }] },
    },
  });
  cleanupBoardIds.push(sourceBoardId);

  const cloned = await cloneBoard(sourceBoardId, teacherDto, {
    title: "[검증용] 안전한 복제본",
    includeSections: true,
    includePosts: true,
    includeAttachments: true,
    includeSettings: true,
    includeMembers: true,
  });
  cleanupBoardIds.push(cloned.id);
  assert.deepEqual(cloned.copied, { sections: 1, posts: 1, attachments: 2, members: 1 });
  const cloneRow = await prisma.board.findUnique({
    where: { id: cloned.id },
    select: {
      ownerId: true,
      discoveryScope: true,
      visitorPermission: true,
      loginRequired: true,
      passwordHash: true,
      state: true,
      freezeAt: true,
      isTemplate: true,
      backgroundColor: true,
      sections: { select: { id: true } },
      members: { orderBy: { userId: "asc" }, select: { userId: true, role: true } },
      posts: {
        select: {
          authorId: true,
          title: true,
          status: true,
          attachments: { orderBy: { sortOrder: "asc" }, select: { type: true, storagePath: true, thumbnailPath: true, externalUrl: true, previewImageUrl: true } },
        },
      },
    },
  });
  assert.ok(cloneRow);
  assert.equal(cloneRow.ownerId, teacher.id);
  assert.equal(cloneRow.discoveryScope, "PRIVATE");
  assert.equal(cloneRow.visitorPermission, "NO_ACCESS");
  assert.equal(cloneRow.loginRequired, true);
  assert.equal(cloneRow.passwordHash, null);
  assert.equal(cloneRow.state, "ACTIVE");
  assert.equal(cloneRow.freezeAt, null);
  assert.equal(cloneRow.isTemplate, false);
  assert.equal(cloneRow.backgroundColor, "#eef6f0");
  assert.equal(cloneRow.sections.length, 1);
  assert.equal(cloneRow.posts.length, 1, "승인 대기 게시물은 복제하면 안 됩니다.");
  assert.equal(cloneRow.posts[0].authorId, teacher.id, "복제 게시물 작성자는 새 소유자여야 합니다.");
  assert.equal(cloneRow.posts[0].status, "PUBLISHED");
  assert.equal(cloneRow.members.find((member) => member.userId === teacher.id)?.role, "OWNER");
  assert.equal(cloneRow.members.find((member) => member.userId === student.id)?.role, "MEMBER");
  const copiedFile = cloneRow.posts[0].attachments.find((attachment) => attachment.type === "FILE");
  const copiedLink = cloneRow.posts[0].attachments.find((attachment) => attachment.type === "LINK");
  assert.ok(copiedFile?.storagePath && copiedFile.storagePath !== sourceStoragePath);
  assert.equal(copiedLink?.externalUrl, "https://example.com/resource");
  assert.equal(copiedLink?.previewImageUrl, "https://example.com/resource-card.jpg");
  cleanupFiles.push({ storagePath: copiedFile.storagePath, thumbnailPath: copiedFile.thumbnailPath });

  const savedBoard = await prisma.board.create({
    data: {
      id: randomUUID(),
      slug: `verify-reuse-saved-${suffix}`,
      title: "[검증용] 폴더 공개 보드",
      ownerId: teacher.id,
      activityId: await createPadActivity(prisma, teacher.id, "[검증용] 폴더 공개 보드"),
      discoveryScope: "PUBLIC",
      visitorPermission: "READER",
      loginRequired: true,
      members: { create: { userId: teacher.id, role: "OWNER" } },
    },
    select: { id: true },
  });
  cleanupBoardIds.push(savedBoard.id);
  const folder = await prisma.dashboardFolder.create({
    data: {
      userId: student.id,
      name: `[검증용] ${suffix}`,
      nameKey: `[검증용] ${suffix}`.toLocaleLowerCase("ko"),
      boards: { create: [{ boardId: sourceBoardId }, { boardId: savedBoard.id }] },
    },
    select: { id: true },
  });
  cleanupFolderIds.push(folder.id);
  await prisma.boardFavorite.create({ data: { boardId: sourceBoardId, userId: student.id } });
  const dashboard = await getDashboardHomeData(studentDto);
  assert.equal(dashboard.myBoards.find((board) => board.id === sourceBoardId)?.isFavorite, true);
  assert.equal(dashboard.myBoards.find((board) => board.id === savedBoard.id)?.relation, "SAVED");
  assert.ok(dashboard.dashboardFolders.find((item) => item.id === folder.id)?.boardIds.includes(savedBoard.id));
  assert.ok(dashboard.templateBoards.some((board) => board.id === sourceBoardId));

  await prisma.attachment.create({
    data: {
      postId: publishedPostId,
      uploaderId: student.id,
      type: "FILE",
      originalName: "없는_파일.txt",
      storedName: `${randomUUID()}.txt`,
      storagePath: `boards/${sourceBoardId}/posts/${publishedPostId}/missing-${randomUUID()}.txt`,
      mimeType: "text/plain",
      fileSize: 1,
      sortOrder: 2,
    },
  });
  await assert.rejects(() => cloneBoard(sourceBoardId, teacherDto, {
    title: "[검증용] 실패해야 하는 복제본",
    includeSections: true,
    includePosts: true,
    includeAttachments: true,
    includeSettings: true,
    includeMembers: false,
  }));
  assert.equal(await prisma.board.count({ where: { title: "[검증용] 실패해야 하는 복제본" } }), 0, "첨부 복제 실패 시 새 보드가 남으면 안 됩니다.");

  console.log(`board_reuse_checks=passed clone=${cloned.id} folders=${dashboard.dashboardFolders.length} templates=${dashboard.templateBoards.length}`);
}

main()
  .catch((error) => {
    console.error(error instanceof Error ? error.stack ?? error.message : "보드 재사용 검증에 실패했습니다.");
    process.exitCode = 1;
  })
  .finally(async () => {
    const prisma = getPrisma();
    if (cleanupFolderIds.length) await prisma.dashboardFolder.deleteMany({ where: { id: { in: cleanupFolderIds } } });
    if (cleanupBoardIds.length) await prisma.activity.deleteMany({ where: { board: { id: { in: cleanupBoardIds } } } });
    await removeStoredAttachmentFiles(cleanupFiles);
    for (const boardId of cleanupBoardIds) await rm(path.join(getUploadRoot(), "boards", boardId), { recursive: true, force: true }).catch(() => undefined);
    await prisma.$disconnect();
  });
