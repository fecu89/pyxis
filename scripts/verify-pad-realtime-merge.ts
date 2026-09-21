import assert from "node:assert/strict";
import { applyBoardEventDelta, reconcileSectionsPreservingLayout, restorePostDragOrigin } from "../components/pad/reconcile-sections";
import type { PostData, SectionData } from "../components/pad/types";
import { adjacentInsertionNeighbors, positionBetween } from "../lib/board/rank";

function post(id: string, options: Partial<PostData> = {}): PostData {
  return {
    id,
    title: id,
    body: id,
    bodyFormat: "PLAIN_TEXT",
    status: "PUBLISHED",
    moderationReason: null,
    customFieldValues: null,
    position: 1024,
    isPinned: false,
    version: 1,
    createdAt: "2026-08-13T00:00:00.000Z",
    updatedAt: "2026-08-13T00:00:00.000Z",
    author: { id: "author", name: "작성자", image: null, isGuest: false },
    isMine: false,
    attachments: [],
    viewerReacted: false,
    reactionCount: 0,
    viewerReactions: [],
    reactionCounts: {},
    commentCount: 0,
    comments: [],
    ...options,
  };
}

function section(id: string, posts: PostData[], options: Partial<SectionData> = {}): SectionData {
  return { id, title: id, description: null, position: 1024, version: 1, totalPostCount: posts.length, posts, ...options };
}

const moved = post("moved");
const neighbor = post("neighbor");
const newPost = post("new", { position: 4096 });
const current = [section("target", [neighbor, moved]), section("source", [])];
// 카드 이동 요청보다 먼저 시작한 서버 렌더처럼 moved가 아직 원래 섹션에 있는 스냅샷입니다.
const staleWithNewPost = [section("source", [moved]), section("target", [neighbor, newPost])];
const merged = reconcileSectionsPreservingLayout(current, staleWithNewPost, "END");

assert.deepEqual(merged.map((item) => item.id), ["target", "source"], "로컬 섹션 순서를 보존해야 합니다.");
assert.deepEqual(merged[0].posts.map((item) => item.id), ["neighbor", "moved", "new"], "옮긴 카드는 유지하고 새 카드만 끝에 추가해야 합니다.");
assert.deepEqual(merged[1].posts, [], "낡은 스냅샷이 옮긴 카드를 원래 섹션으로 되돌리면 안 됩니다.");
assert.equal(merged[0].totalPostCount, 3, "전체 렌더링에서는 표시 개수와 섹션 개수가 같아야 합니다.");

const pinned = post("pinned", { isPinned: true });
const first = post("first", { position: 0 });
const startMerged = reconcileSectionsPreservingLayout(
  [section("section", [pinned, neighbor])],
  [section("section", [pinned, first, neighbor])],
  "START",
);
assert.deepEqual(startMerged[0].posts.map((item) => item.id), ["pinned", "first", "neighbor"], "앞에 추가한 새 글도 고정 글 뒤에 배치해야 합니다.");

// 클라이언트가 old-last 뒤로 이동을 요청한 후 new가 먼저 생긴 경쟁 상황입니다.
const ranked = [
  { id: "old-middle", position: 2048 },
  { id: "old-last", position: 3072 },
  { id: "concurrent-new", position: 4096 },
];
const insertion = adjacentInsertionNeighbors(ranked, "old-last", null);
assert.equal(insertion.previous?.id, "old-last");
assert.equal(insertion.next?.id, "concurrent-new", "낡은 끝 앵커 뒤의 새 글을 현재 이웃으로 다시 찾아야 합니다.");
assert.equal(positionBetween(insertion.previous?.position ?? null, insertion.next?.position ?? null), 3584, "이동 카드에는 중복되지 않는 중간 position을 배정해야 합니다.");

// 드래그 취소는 시작 당시 배열 전체로 롤백하면 안 됩니다. 그 사이 SSE로 들어온 새 글을 남기고,
// 움직인 카드 한 장만 원래 이웃 사이에 돌려놓아야 합니다.
const duringDrag = [
  section("source", [post("concurrent"), neighbor]),
  section("target", [moved, newPost]),
];
const restored = restorePostDragOrigin(duringDrag, {
  postId: "moved",
  sectionId: "source",
  index: 1,
  previousItemId: "neighbor",
  nextItemId: null,
});
assert.deepEqual(restored[0].posts.map((item) => item.id), ["concurrent", "neighbor", "moved"], "동시 생성 글을 보존하면서 원래 이웃 뒤로 복원해야 합니다.");
assert.deepEqual(restored[1].posts.map((item) => item.id), ["new"], "이동 중이던 카드는 대상 섹션에서 제거해야 합니다.");
assert.equal(restored[0].totalPostCount, 3);
assert.equal(restored[1].totalPostCount, 1);

// 평상시 이벤트는 서버 컴포넌트 재실행 없이 완성된 델타만 합칩니다.
const eventBase = [section("source", [post("existing", { position: 1024 })]), section("target", [])];
const createdPost = post("created", { position: 2048, version: 2 });
const afterCreate = applyBoardEventDelta(eventBase, {
  type: "post.created",
  entityId: createdPost.id,
  sectionId: "source",
  payload: { post: createdPost },
}, "END", null);
assert.deepEqual(afterCreate[0].posts.map((item) => item.id), ["existing", "created"]);
assert.equal(afterCreate[0].totalPostCount, 2);

const afterUnloadedDelete = applyBoardEventDelta([
  section("source", [post("loaded")], { totalPostCount: 2 }),
], {
  type: "post.deleted",
  entityId: "unloaded",
  sectionId: "source",
}, "END", null);
assert.deepEqual(afterUnloadedDelete[0].posts.map((item) => item.id), ["loaded"]);
assert.equal(afterUnloadedDelete[0].totalPostCount, 1, "페이지 밖 글 삭제도 섹션 총 개수에 반영해야 합니다.");

const afterComment = applyBoardEventDelta(afterCreate, {
  type: "comment.created",
  entityId: "comment-1",
  postId: "created",
  payload: {
    commentCount: 1,
    comment: {
      id: "comment-1",
      body: "동시에 도착한 댓글",
      createdAt: "2026-08-13T00:01:00.000Z",
      attachments: [],
      author: { id: "commenter", name: "댓글 작성자", image: null, isGuest: false },
      isMine: false,
    },
  },
}, "END", null);
assert.equal(afterComment[0].posts[1].comments[0]?.body, "동시에 도착한 댓글");
assert.equal(afterComment[0].posts[1].commentCount, 1);

const commentAttachment = {
  id: "comment-attachment-1",
  type: "AUDIO" as const,
  originalName: "voice.webm",
  mimeType: "audio/webm",
  fileSize: 10,
  width: null,
  height: null,
  altText: null,
  caption: null,
  externalUrl: null,
  previewImageUrl: null,
};
const afterCommentAttachment = applyBoardEventDelta(afterComment, {
  type: "attachment.created",
  entityId: commentAttachment.id,
  postId: "created",
  payload: { commentAttachment: { commentId: "comment-1", attachment: commentAttachment } },
}, "END", null);
assert.equal(afterCommentAttachment[0].posts[1].comments[0]?.attachments[0]?.id, commentAttachment.id);
assert.equal(afterCommentAttachment[0].posts[1].attachments.length, 0, "댓글 첨부가 게시물 첨부로 섞이면 안 됩니다.");

const afterAttachment = applyBoardEventDelta(afterCommentAttachment, {
  type: "attachment.created",
  entityId: "attachment-1",
  postId: "created",
  payload: {
    attachment: {
      id: "attachment-1",
      type: "IMAGE",
      originalName: "image.webp",
      mimeType: "image/webp",
      fileSize: 10,
      width: 10,
      height: 10,
      altText: null,
      caption: null,
      externalUrl: null,
      previewImageUrl: null,
    },
  },
}, "END", null);
assert.equal(afterAttachment[0].posts[1].attachments[0]?.id, "attachment-1");

const afterMove = applyBoardEventDelta(afterAttachment, {
  type: "post.reordered",
  entityId: "created",
  sectionId: "target",
  payload: {
    postMove: {
      sectionId: "target",
      position: 1024,
      version: 3,
      previousItemId: null,
      nextItemId: null,
    },
  },
}, "END", null);
assert.deepEqual(afterMove[0].posts.map((item) => item.id), ["existing"], "이동 이벤트가 다른 카드를 지우면 안 됩니다.");
assert.deepEqual(afterMove[1].posts.map((item) => item.id), ["created"]);
assert.equal(afterMove[0].totalPostCount, 1);
assert.equal(afterMove[1].totalPostCount, 1);

const staleUpdate = applyBoardEventDelta(afterMove, {
  type: "post.updated",
  entityId: "created",
  sectionId: "target",
  payload: { post: post("created", { body: "낡은 본문", version: 2 }) },
}, "END", null);
assert.equal(staleUpdate[1].posts[0].version, 3, "낮은 version의 늦은 이벤트가 최신 카드를 덮으면 안 됩니다.");

// 다른 카드 X를 이 탭에서 아직 저장 중인 동안 원격 카드 Y의 이동이 도착해도, 전체 position
// 정렬로 X를 되돌리지 않고 Y 한 장만 서버가 확정한 이웃 사이에 넣어야 합니다.
const optimisticOrder = [section("target", [
  post("x", { position: 4096 }),
  post("a", { position: 1024 }),
  post("b", { position: 2048 }),
  post("y", { position: 3072 }),
])];
const withRemoteMove = applyBoardEventDelta(optimisticOrder, {
  type: "post.reordered",
  entityId: "y",
  sectionId: "target",
  payload: {
    postMove: {
      sectionId: "target",
      position: 1536,
      version: 2,
      previousItemId: "a",
      nextItemId: "b",
    },
  },
}, "END", null);
assert.deepEqual(withRemoteMove[0].posts.map((item) => item.id), ["x", "a", "y", "b"], "원격 이동이 로컬의 미확정 X 배치를 되돌리면 안 됩니다.");

const optimisticSectionOrder = [
  section("section-b", []),
  section("section-a", [], { position: 1024 }),
];
const afterSectionTitle = applyBoardEventDelta(optimisticSectionOrder, {
  type: "section.updated",
  entityId: "section-a",
  sectionId: "section-a",
  payload: { sectionPatch: { id: "section-a", title: "바뀐 제목", version: 2 } },
}, "END", null);
assert.deepEqual(afterSectionTitle.map((item) => item.id), ["section-b", "section-a"], "섹션 제목 수정이 진행 중인 로컬 섹션 순서를 되돌리면 안 됩니다.");
assert.equal(afterSectionTitle[1].title, "바뀐 제목");

// 아직 저장 중인 다음 이동이 있으면 이전 요청의 SSE는 내용/버전만 갱신하고 위치는 보존합니다.
const pendingRoundtrip = [section("source", [post("moving")]), section("target", [])];
const delayedMove = {
  type: "post.reordered" as const, entityId: "moving", sectionId: "target",
  payload: { postMove: { sectionId: "target", position: 2048, version: 2, previousItemId: null, nextItemId: null } },
};
const protectedRoundtrip = applyBoardEventDelta(pendingRoundtrip, delayedMove, "END", null, new Set(["moving"]));
assert.deepEqual(protectedRoundtrip[0].posts.map(post => post.id), ["moving"], "저장 중인 마지막 위치를 이전 SSE가 덮으면 안 됩니다.");
assert.equal(protectedRoundtrip[0].posts[0].version, 2);
assert.equal(protectedRoundtrip[0].posts[0].body, "moving");
assert.equal(protectedRoundtrip[0].totalPostCount, 1);
assert.equal(protectedRoundtrip[1].totalPostCount, 0);
const unprotectedMove = applyBoardEventDelta(pendingRoundtrip, delayedMove, "END", null, new Set(["another-post"]));
assert.equal(unprotectedMove[1].posts[0].id, "moving", "다른 카드의 원격 이동은 계속 반영해야 합니다.");

console.log("pad_realtime_merge_checks=passed");
