import assert from "node:assert/strict";
import { test } from "node:test";
import {
  boardAcceptsGuestComments, boardAcceptsGuestPosts, canComment, canCreatePost,
  canDeleteComment, canEditComment, canEditPost, canReact, canReadEffectiveBoard, canUploadFile,
  determineGuestPostStatus, guestOwnsContent, type AuthorizationUser, type EffectiveBoardAccess,
} from "../lib/auth/authorization";
import { normalizeBoardAccessSettings } from "../lib/board/validators";

const user = { id: "visitor", role: "TEACHER", systemPermissions: [], school: null, isSchoolRepresentative: false } satisfies AuthorizationUser;
const base = {
  id: "board", ownerId: "owner", title: "패드", discoveryScope: "LINK", visitorPermission: "READER",
  loginRequired: false, passwordHash: null, state: "ACTIVE", moderationMode: "NONE", freezeAt: null,
  allowMemberPosting: true, guestPostsRequireApproval: true, allowMemberFileUpload: true,
  allowComments: true, allowReactions: true, reactionPolicy: "SINGLE", attachmentDownloadPolicy: "READERS",
  owner: { id: "owner", nameEncrypted: null, imageEncrypted: null, role: "TEACHER" },
} as EffectiveBoardAccess["board"];
function access(patch: Partial<EffectiveBoardAccess["board"]> = {}): EffectiveBoardAccess {
  return { board: { ...base, ...patch }, role: null, isOwner: false };
}

// PUBLIC 전용 분기 또는 PRIVATE 차단 누락이 있으면 이 표가 실패합니다.
for (const [scope, permission, login, want] of [
  ["LINK", "WRITER", false, true], ["LINK", "READER", false, false],
  ["LINK", "COMMENTER", false, false], ["LINK", "NO_ACCESS", false, false],
  ["LINK", "WRITER", true, false], ["PUBLIC", "WRITER", false, true],
  ["PUBLIC", "WRITER", true, false], ["PUBLIC", "READER", false, false],
  ["PRIVATE", "WRITER", false, false],
] as const) {
  test(`손님 글쓰기 ${scope}/${permission}/login=${login}`, () => {
    assert.equal(boardAcceptsGuestPosts({ discoveryScope: scope, visitorPermission: permission, loginRequired: login }), want);
  });
}

test("링크 쓰기 opt-in을 저장해도 읽기 전용으로 덮어쓰지 않는다", () => {
  assert.deepEqual(normalizeBoardAccessSettings({ discoveryScope: "LINK", visitorPermission: "WRITER", loginRequired: false }),
    { discoveryScope: "LINK", visitorPermission: "WRITER", loginRequired: false });
});
test("기본·과거 링크 설정은 비로그인 읽기 전용으로 정규화한다", () => {
  assert.deepEqual(normalizeBoardAccessSettings({ discoveryScope: "LINK", visitorPermission: "NO_ACCESS", loginRequired: true }),
    { discoveryScope: "LINK", visitorPermission: "READER", loginRequired: false });
});
test("공개 범위만 LINK로 바꾸는 요청은 이전 WRITER를 자동 승계하지 않는다", () => {
  assert.deepEqual(normalizeBoardAccessSettings(
    { discoveryScope: "LINK", visitorPermission: "WRITER", loginRequired: false },
    { discoveryScope: "LINK" },
  ), { discoveryScope: "LINK", visitorPermission: "READER", loginRequired: false });
});
test("링크의 제목 등 무관한 설정 변경은 활성화된 쓰기 권한을 유지한다", () => {
  assert.equal(normalizeBoardAccessSettings({ discoveryScope: "LINK", visitorPermission: "WRITER", loginRequired: false }, {}).visitorPermission, "WRITER");
});
test("과거 LINK/WRITER/loginRequired=true를 무관한 수정만으로 활성화하지 않는다", () => {
  assert.equal(normalizeBoardAccessSettings({ discoveryScope: "LINK", visitorPermission: "WRITER", loginRequired: true }, {}).visitorPermission, "READER");
});
for (const scope of ["LINK", "PUBLIC"] as const) {
  test(`${scope} 로그인 방문자도 쓰기·첨부·댓글·자기 콘텐츠 관리가 가능하다`, () => {
    const a = access({ discoveryScope: scope, visitorPermission: "WRITER" });
    assert.equal(canCreatePost(user, a), true);
    assert.equal(canUploadFile(user, a), true);
    assert.equal(canComment(user, a), true);
    assert.equal(canReact(user, a), true);
    assert.equal(canEditPost({ user, access: a, postAuthorId: user.id }), true);
    assert.equal(canEditComment({ user, access: a, commentAuthorId: user.id }), true);
    assert.equal(canDeleteComment({ user, access: a, commentAuthorId: user.id }), true);
    assert.equal(canEditPost({ user, access: a, postAuthorId: "someone-else" }), false);
  });
}
test("읽기 전용 링크에서는 로그인 방문자도 새 글과 기존 자기 글 변경이 막힌다", () => {
  const a = access();
  assert.equal(canReadEffectiveBoard(null, a), true);
  assert.equal(canCreatePost(user, a), false);
  assert.equal(canUploadFile(user, a), false);
  assert.equal(canEditPost({ user, access: a, postAuthorId: user.id }), false);
  assert.equal(canEditComment({ user, access: a, commentAuthorId: user.id }), false);
  assert.equal(canDeleteComment({ user, access: a, commentAuthorId: user.id }), false);
});
test("비공개로 전환하면 남은 WRITER 값만으로 방문자가 쓸 수 없다", () => {
  const a = access({ discoveryScope: "PRIVATE", visitorPermission: "WRITER" });
  assert.equal(canReadEffectiveBoard(user, a), false);
  assert.equal(canCreatePost(user, a), false);
  assert.equal(canUploadFile(user, a), false);
});
test("손님 댓글은 글쓰기와 댓글 설정을 모두 따른다", () => {
  const b = { ...base, visitorPermission: "WRITER" as const };
  assert.equal(boardAcceptsGuestComments(b), true);
  assert.equal(boardAcceptsGuestComments({ ...b, allowComments: false }), false);
  assert.equal(boardAcceptsGuestComments({ ...b, visitorPermission: "READER" }), false);
});
test("승인·소유권 보호는 그대로 유지한다", () => {
  assert.equal(determineGuestPostStatus(base), "PENDING");
  assert.equal(determineGuestPostStatus({ ...base, guestPostsRequireApproval: false }), "PUBLISHED");
  assert.equal(determineGuestPostStatus({ ...base, guestPostsRequireApproval: false, moderationMode: "MANUAL" }), "PENDING");
  assert.equal(guestOwnsContent({ authorId: null, guestId: "guest-a" }, "guest-a"), true);
  assert.equal(guestOwnsContent({ authorId: null, guestId: "guest-a" }, "guest-b"), false);
});
