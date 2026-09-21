import "../lib/load-env";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { encode } from "next-auth/jwt";
import { getPrisma } from "../lib/prisma";
import { createLoginIdentifierLookup, encryptOptionalUserPii, encryptUserPii } from "../lib/security/pii-crypto-core";

// 127.0.0.1이 아니라 localhost입니다. `.env.development`의 APP_ORIGINS가 localhost:3001만
// 허용하고 lib/http.ts의 assertSameOrigin은 호스트를 문자열로 비교하므로, 127.0.0.1로 보내면
// 쓰기 요청이 전부 403("허용되지 않은 요청 출처입니다")으로 막힙니다.
const baseUrl = process.env.VERIFY_BASE_URL || "http://localhost:3001";
const fieldId = "verify_note";
const fieldKey = "field_verify_note";

type ApiResult = {
  board?: { id?: string; layout?: string; reactionPolicy?: string };
  post?: { id?: string };
  attachment?: { id?: string; type?: string };
  viewerReactions?: string[];
  comment?: { id?: string; parentId?: string | null };
  comments?: { id?: string; parentId?: string | null; mentionedUserIds?: string[] }[];
  members?: { user?: { id?: string } }[];
  posts?: { reactionCount?: number; commentCount?: number }[];
};

function requireAuthSecret() {
  const value = process.env.AUTH_SECRET;
  if (!value) throw new Error("AUTH_SECRET 환경 변수가 필요합니다.");
  return value;
}

async function sessionCookie(user: { id: string; authVersion: number }) {
  const token = await encode({
    secret: requireAuthSecret(),
    maxAge: 300,
    token: { userId: user.id, authVersion: user.authVersion, sessionInvalid: false },
  });
  return `next-auth.session-token=${token}; __Secure-next-auth.session-token=${token}`;
}

function jsonHeaders(cookie: string) {
  return { Cookie: cookie, Origin: baseUrl, "Content-Type": "application/json" };
}

async function json(response: Response) {
  return response.json() as Promise<ApiResult>;
}

async function main() {
  const prisma = getPrisma();
  const owner = await prisma.user.findFirst({
    where: { role: { in: ["TEACHER", "SUPER_ADMIN"] }, status: "ACTIVE" },
    orderBy: { role: "asc" },
    select: { id: true, authVersion: true },
  });
  assert.ok(owner, "검증용 활성 교사 또는 전체관리자가 필요합니다.");
  const mentionTarget = await prisma.user.findFirst({
    where: { id: { not: owner.id }, status: "ACTIVE" },
    orderBy: { createdAt: "asc" },
    select: { id: true },
  });
  assert.ok(mentionTarget, "멘션 알림 검증을 위한 두 번째 활성 사용자가 필요합니다.");
  const cookie = await sessionCookie(owner);
  let boardId: string | null = null;
  let deletedMentionUserId: string | null = null;

  try {
    const createBoard = await fetch(`${baseUrl}/api/boards`, {
      method: "POST",
      headers: jsonHeaders(cookie),
      body: JSON.stringify({ title: `[검증용] 게시물 참여 ${Date.now()}`, discoveryScope: "PRIVATE" }),
    });
    assert.equal(createBoard.status, 201, "검증용 보드가 생성되어야 합니다.");
    const createdBoard = await json(createBoard);
    boardId = createdBoard.board?.id ?? null;
    assert.ok(boardId, "생성된 보드 ID가 필요합니다.");
    await prisma.boardMember.create({
      data: { boardId, userId: mentionTarget.id, role: "MEMBER" },
    });
    deletedMentionUserId = randomUUID();
    const deletedMentionEmail = `verify-deleted-mention-${deletedMentionUserId}@invalid.local`;
    await prisma.user.create({
      data: {
        id: deletedMentionUserId,
        loginIdentifierLookup: createLoginIdentifierLookup(deletedMentionEmail),
        loginIdentifierEncrypted: encryptUserPii(deletedMentionUserId, "email", deletedMentionEmail),
        nameEncrypted: encryptOptionalUserPii(deletedMentionUserId, "name", "삭제된 멘션 대상"),
        role: "STUDENT",
        status: "DELETED",
        memberships: { create: { boardId, role: "MEMBER" } },
      },
    });
    const visibleMembersResponse = await fetch(`${baseUrl}/api/boards/${boardId}/members`, { headers: { Cookie: cookie } });
    assert.equal(visibleMembersResponse.status, 200);
    const visibleMembers = await json(visibleMembersResponse);
    assert.ok(
      !visibleMembers.members?.some((member) => member.user?.id === deletedMentionUserId),
      "과거 관계가 남은 삭제 사용자는 멤버 관리 목록에서 제외되어야 합니다.",
    );
    // 패드 생성 API는 기본 섹션을 만들지 않습니다(예전에는 만들었습니다). 검증에 쓸 섹션은
    // 여기서 실제 API로 만듭니다.
    const createSection = await fetch(`${baseUrl}/api/boards/${boardId}/sections`, {
      method: "POST",
      headers: jsonHeaders(cookie),
      body: JSON.stringify({ title: "검증용 섹션" }),
    });
    assert.equal(createSection.status, 201, "검증용 섹션이 생성되어야 합니다.");
    const section = await prisma.section.findFirstOrThrow({ where: { boardId, deletedAt: null }, orderBy: { position: "asc" }, select: { id: true } });

    const postFieldConfig = {
      version: 2,
      title: { visible: true, required: true, placeholder: "제목" },
      body: { visible: true, required: true, placeholder: "본문" },
      attachment: { visible: true, required: false, placeholder: "첨부" },
      customFields: [{ id: fieldId, key: fieldKey, label: "확인 메모", kind: "SHORT_TEXT", required: true, position: 0, options: [], version: 1, archived: false }],
    };
    const updateBoard = await fetch(`${baseUrl}/api/boards/${boardId}`, {
      method: "PATCH",
      headers: jsonHeaders(cookie),
      body: JSON.stringify({
        layout: "TABLE",
        sortMode: "TITLE",
        newPostPlacement: "START",
        cardSize: "SMALL",
        font: "MONO",
        backgroundColor: "#f0f0f0",
        accentColor: "#315f44",
        showAuthor: false,
        showTimestamp: false,
        reactionPolicy: "SINGLE",
        attachmentDownloadPolicy: "MEMBERS",
        postFieldConfig,
      }),
    });
    assert.equal(updateBoard.status, 200, "보드 표현·필드 설정이 저장되어야 합니다.");
    const updatedBoard = await json(updateBoard);
    assert.equal(updatedBoard.board?.layout, "TABLE");
    assert.equal(updatedBoard.board?.reactionPolicy, "SINGLE");

    const stalePost = await fetch(`${baseUrl}/api/sections/${section.id}/posts`, {
      method: "POST",
      headers: jsonHeaders(cookie),
      body: JSON.stringify({ title: "오래된 폼", body: "거부되어야 함", fieldConfigVersion: 1, customFieldValues: { [fieldId]: "값" } }),
    });
    assert.equal(stalePost.status, 400, "오래된 필드 설정 버전 제출은 거부되어야 합니다.");

    const createPost = await fetch(`${baseUrl}/api/sections/${section.id}/posts`, {
      method: "POST",
      headers: jsonHeaders(cookie),
      body: JSON.stringify({ title: "검증 게시물", body: "참여 기능 회귀 본문", fieldConfigVersion: 2, customFieldValues: { [fieldId]: "저장된 값" } }),
    });
    assert.equal(createPost.status, 201, "현재 필드 버전 게시물이 생성되어야 합니다.");
    const createdPost = await json(createPost);
    const postId = createdPost.post?.id as string | undefined;
    assert.ok(postId, "생성된 게시물 ID가 필요합니다.");

    const link = await fetch(`${baseUrl}/api/posts/${postId}/links`, {
      method: "POST",
      headers: jsonHeaders(cookie),
      body: JSON.stringify({
        url: "https://example.com/resource",
        title: "검증 링크",
        description: "로컬 파일 없는 첨부",
        previewImageUrl: "https://example.com/resource-card.jpg",
      }),
    });
    assert.equal(link.status, 201, "링크 첨부가 저장되어야 합니다.");
    const linkResult = await json(link);
    assert.equal(linkResult.attachment?.type, "LINK");

    const privatePreview = await fetch(`${baseUrl}/api/posts/${postId}/links`, {
      method: "POST",
      headers: jsonHeaders(cookie),
      body: JSON.stringify({
        url: "https://example.com/private-preview-check",
        title: "내부망 대표 이미지 거부 검증",
        previewImageUrl: "http://127.0.0.1/private.png",
      }),
    });
    assert.equal(privatePreview.status, 400, "직접 API를 호출해도 내부망 대표 이미지 주소는 저장되면 안 됩니다.");

    await prisma.attachment.createMany({
      data: Array.from({ length: 19 }, (_, index) => ({
        postId,
        uploaderId: owner.id,
        type: "LINK" as const,
        originalName: `제한 검증 링크 ${index + 1}`,
        storedName: null,
        storagePath: null,
        mimeType: "text/uri-list",
        fileSize: 0,
        externalUrl: `https://example.com/limit/${index + 1}`,
        sortOrder: index + 1,
      })),
    });
    const overLimitLink = await fetch(`${baseUrl}/api/posts/${postId}/links`, {
      method: "POST",
      headers: jsonHeaders(cookie),
      body: JSON.stringify({ url: "https://example.com/too-many", title: "21번째 링크" }),
    });
    assert.equal(overLimitLink.status, 400, "게시물의 21번째 파일·링크 첨부는 거부되어야 합니다.");

    const like = await fetch(`${baseUrl}/api/posts/${postId}/reactions`, {
      method: "PUT",
      headers: jsonHeaders(cookie),
      body: JSON.stringify({ key: "LIKE", active: true }),
    });
    assert.equal(like.status, 200, "좋아요 반응이 저장되어야 합니다.");
    const heart = await fetch(`${baseUrl}/api/posts/${postId}/reactions`, {
      method: "PUT",
      headers: jsonHeaders(cookie),
      body: JSON.stringify({ key: "HEART", active: true }),
    });
    assert.equal(heart.status, 200, "하트 반응이 저장되어야 합니다.");
    const singleResult = await json(heart);
    assert.deepEqual(singleResult.viewerReactions, ["HEART"], "SINGLE 정책은 기존 반응을 교체해야 합니다.");

    const multiplePolicy = await fetch(`${baseUrl}/api/boards/${boardId}`, {
      method: "PATCH",
      headers: jsonHeaders(cookie),
      body: JSON.stringify({ reactionPolicy: "MULTIPLE" }),
    });
    assert.equal(multiplePolicy.status, 200, "다중 반응 정책으로 전환되어야 합니다.");
    const secondReaction = await fetch(`${baseUrl}/api/posts/${postId}/reactions`, {
      method: "PUT",
      headers: jsonHeaders(cookie),
      body: JSON.stringify({ key: "LIKE", active: true }),
    });
    assert.equal(secondReaction.status, 200);
    const multipleResult = await json(secondReaction);
    assert.deepEqual(new Set(multipleResult.viewerReactions), new Set(["HEART", "LIKE"]), "MULTIPLE 정책은 여러 키를 유지해야 합니다.");

    const createComment = await fetch(`${baseUrl}/api/posts/${postId}/comments`, {
      method: "POST",
      headers: jsonHeaders(cookie),
      body: JSON.stringify({ body: "@검증대상 첫 댓글", parentId: null, mentionedUserIds: [mentionTarget.id] }),
    });
    assert.equal(createComment.status, 201, "댓글이 생성되어야 합니다.");
    const firstComment = await json(createComment);
    const commentId = firstComment.comment?.id as string | undefined;
    assert.ok(commentId);
    const mentionDeletedUser = await fetch(`${baseUrl}/api/posts/${postId}/comments`, {
      method: "POST",
      headers: jsonHeaders(cookie),
      body: JSON.stringify({ body: "@삭제된_멘션_대상", parentId: null, mentionedUserIds: [deletedMentionUserId] }),
    });
    assert.equal(mentionDeletedUser.status, 400, "삭제 사용자는 관계가 남아 있어도 새로 멘션할 수 없어야 합니다.");
    const createReply = await fetch(`${baseUrl}/api/posts/${postId}/comments`, {
      method: "POST",
      headers: jsonHeaders(cookie),
      body: JSON.stringify({ body: "답글", parentId: commentId, mentionedUserIds: [] }),
    });
    assert.equal(createReply.status, 201, "같은 게시물 댓글의 답글이 생성되어야 합니다.");
    const reply = await json(createReply);
    assert.equal(reply.comment?.parentId, commentId);
    const flatCommentsResponse = await fetch(`${baseUrl}/api/posts/${postId}/comments`, { headers: { Cookie: cookie } });
    assert.equal(flatCommentsResponse.status, 200, "댓글 목록을 불러올 수 있어야 합니다.");
    const flatComments = await json(flatCommentsResponse);
    assert.equal(flatComments.comments?.length, 2, "기존 답글도 평면 댓글 목록에 포함되어야 합니다.");
    assert.ok(flatComments.comments?.some((comment) => comment.parentId === commentId), "기존 parentId는 데이터 호환을 위해 유지되어야 합니다.");
    assert.ok(flatComments.comments?.some((comment) => comment.mentionedUserIds?.includes(mentionTarget.id)), "멘션 관계가 댓글 응답에 포함되어야 합니다.");
    const mentionNotification = await prisma.notification.findFirst({
      where: {
        userId: mentionTarget.id,
        actorId: owner.id,
        type: "COMMENT_MENTIONED",
        boardId,
        postId,
        commentId,
      },
      select: { id: true },
    });
    assert.ok(mentionNotification, "멘션 대상에게 댓글 위치가 연결된 알림이 생성되어야 합니다.");
    const updateComment = await fetch(`${baseUrl}/api/comments/${commentId}`, {
      method: "PATCH",
      headers: jsonHeaders(cookie),
      body: JSON.stringify({ body: "수정된 댓글", mentionedUserIds: [] }),
    });
    assert.equal(updateComment.status, 200, "본인 댓글을 수정할 수 있어야 합니다.");

    const search = await fetch(`${baseUrl}/api/boards/${boardId}/search?q=${encodeURIComponent("검증 게시물")}`, { headers: { Cookie: cookie } });
    assert.equal(search.status, 200, "보드 서버 검색이 동작해야 합니다.");
    const searchResult = await json(search);
    assert.equal(searchResult.posts?.length, 1);
    assert.equal(searchResult.posts?.[0]?.reactionCount, 2);
    assert.equal(searchResult.posts?.[0]?.commentCount, 2);

    const [storedBoard, storedPost, storedLink] = await Promise.all([
      prisma.board.findUniqueOrThrow({ where: { id: boardId }, select: { layout: true, sortMode: true, postFieldConfig: true, reactionPolicy: true, attachmentDownloadPolicy: true } }),
      prisma.post.findUniqueOrThrow({ where: { id: postId }, select: { customFieldValues: true } }),
      prisma.attachment.findUniqueOrThrow({ where: { id: linkResult.attachment.id }, select: { storedName: true, storagePath: true, externalUrl: true, previewImageUrl: true } }),
    ]);
    assert.equal(storedBoard.layout, "TABLE");
    assert.equal(storedBoard.reactionPolicy, "MULTIPLE");
    const storedFields = storedPost.customFieldValues as { configVersion?: number; fields?: Record<string, { fieldVersion?: number }> } | null;
    assert.equal(storedFields?.configVersion, 2);
    assert.equal(storedFields?.fields?.[fieldId]?.fieldVersion, 1);
    assert.equal(storedLink.storedName, null);
    assert.equal(storedLink.storagePath, null);
    assert.equal(storedLink.externalUrl, "https://example.com/resource");
    assert.equal(storedLink.previewImageUrl, "https://example.com/resource-card.jpg");

    console.log("post_participation_checks=passed settings=1 stale_version=400 attachments=20 limit=400 private_preview=400 reactions=2 comments=2 mention_notification=1 deleted_mention=400 search=1");
  } finally {
    if (boardId) {
      await prisma.notification.deleteMany({ where: { boardId } }).catch(() => undefined);
      await prisma.activity.deleteMany({ where: { board: { id: boardId } } }).catch(() => undefined);
    }
    if (deletedMentionUserId) {
      await prisma.user.delete({ where: { id: deletedMentionUserId } }).catch(() => undefined);
    }
    await prisma.$disconnect();
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : "게시물 참여 회귀 검증에 실패했습니다.");
  process.exitCode = 1;
});
