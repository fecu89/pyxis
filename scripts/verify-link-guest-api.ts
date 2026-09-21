import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { createRequire } from "node:module";
import { after, mock, test } from "node:test";
import type { getPrisma } from "../lib/prisma";
import { createBoardPasswordVerificationSignature } from "../lib/board/board-password";
import { encryptUserPii } from "../lib/security/pii-crypto-core";

// 실제 Route Handler·권한·쿠키 서명을 실행하되 DB와 Next 요청 저장소만 대체합니다.
// 테스트가 새 DB 쿼리를 추가하더라도 운영 DB에는 연결할 수 없습니다.
process.env.DATABASE_URL = "postgresql://test:test@127.0.0.1:1/unavailable";
process.env.AUTH_SECRET = "link-guest-api-test-secret";
process.env.PII_ACTIVE_KEY_ID = "test";
process.env.PII_ENCRYPTION_KEY_TEST = Buffer.alloc(32, 1).toString("base64");
process.env.PII_LOOKUP_KEY = Buffer.alloc(32, 2).toString("base64");
const moduleRequire = createRequire(`${process.cwd()}/package.json`);
const nextHeaders = moduleRequire("next/headers");
let cookieValues = new Map<string, string>();
let signedIn = false;
mock.method(nextHeaders, "cookies", async () => ({
  get: (name: string) => cookieValues.has(name) ? { value: cookieValues.get(name) } : undefined,
  set: (name: string, value: string) => cookieValues.set(name, value),
}));
mock.method(nextHeaders, "headers", async () => new Headers(signedIn ? {} : { "x-pyxis-public-guest": "1" }));
mock.method(moduleRequire("next-auth/next"), "getServerSession", async () => signedIn ? { user: { id: "visitor" } } : null);

const board = {
  id: "test-board", ownerId: "owner", title: "패드", discoveryScope: "PUBLIC", visitorPermission: "WRITER",
  loginRequired: false, passwordHash: "current-password-hash", deletedAt: null, state: "FROZEN", freezeAt: null,
  moderationMode: "NONE", guestPostsRequireApproval: true, allowMemberPosting: true, allowMemberFileUpload: true,
  allowComments: true, allowReactions: true, reactionPolicy: "SINGLE", attachmentDownloadPolicy: "READERS",
  owner: null, members: [],
};
const post = { id: "test-post", boardId: board.id, sectionId: "test-section", authorId: null as string | null, guestId: "guest-a" as string | null,
  status: "PUBLISHED", title: "제목", body: "본문", isPinned: false, deletedAt: null as Date | null, customFieldValues: {},
  board: { postFieldConfig: null }, attachments: [], version: 1, createdAt: new Date(), updatedAt: new Date(),
  bodyFormat: "MARKDOWN", moderationReason: null, position: 1024, author: null, guestName: "손님", comments: [], reactions: [], _count: { comments: 0, reactions: 0 } };
const comment = { id: "test-comment", postId: post.id, authorId: null as string | null, guestId: "guest-a" as string | null, body: "댓글", deletedAt: null as Date | null,
  post: { ...post, deletedAt: null } };
const attachment = { id: "test-attachment", postId: post.id, commentId: null, post: { ...post, deletedAt: null }, comment: null, type: "IMAGE", deletedAt: null as Date | null };
const account = {
  id: "visitor", loginIdentifierEncrypted: encryptUserPii("visitor", "email", "test-visitor"), nameEncrypted: null, imageEncrypted: null,
  role: "TEACHER", status: "ACTIVE", registrationApprovalStatus: "APPROVED", registrationReviewReason: null, registrationReviewedAt: null,
  authVersion: 0, passwordHash: "test-hash", mustChangePassword: false, studentNumber: null, onboardingCompletedAt: new Date(),
  createdAt: new Date(), lastLoginAt: null, systemPermissions: [], school: null, schoolGroup: null, isSchoolRepresentative: false,
};
let acceptingWrites = false;
const database = {
  user: { findUnique: async () => account },
  board: { findFirst: async () => board },
  section: { findFirst: async () => ({ id: post.sectionId, boardId: board.id, board: { postFieldConfig: null, newPostPlacement: "END" } }) },
  post: {
    findFirst: async () => post,
    create: async ({ data }: { data: Record<string, unknown> }) => { Object.assign(post, data); return post; },
    updateMany: async ({ where, data }: { where: { version: number }; data: { body?: string } }) => {
      if (where.version !== post.version) return { count: 0 };
      if (data.body !== undefined) post.body = data.body;
      post.version++; return { count: 1 };
    },
    findUniqueOrThrow: async () => post,
  },
  comment: { findFirst: async () => comment, findUnique: async () => comment },
  attachment: { findUnique: async () => attachment, findFirst: async () => attachment, count: async () => 0 },
  boardActivity: { create: async () => ({ id: "test-activity" }) },
  boardMember: { findMany: async () => [] },
  notification: { create: async () => ({ id: "test-notification" }) },
  $queryRaw: async () => [{ id: post.sectionId }],
  $transaction: async (callback: unknown): Promise<unknown> => {
    if (!acceptingWrites) throw new Error("차단되어야 하는 요청이 DB 쓰기에 도달했습니다.");
    return (callback as (transaction: unknown) => Promise<unknown>)(database);
  },
};
const globals = globalThis as unknown as { pyxCoursePrisma?: ReturnType<typeof getPrisma> };
globals.pyxCoursePrisma = database as unknown as ReturnType<typeof getPrisma>;
after(() => { mock.restoreAll(); delete globals.pyxCoursePrisma; });

function prepareCookies(verified: boolean) {
  const payload = Buffer.from(JSON.stringify({ guestId: "guest-a", name: "손님" })).toString("base64url");
  const signature = createHmac("sha256", process.env.AUTH_SECRET!).update(`${board.id}.${payload}`).digest("base64url");
  cookieValues = new Map([[`bgs_${board.id}`, `${payload}.${signature}`]]);
  if (verified) cookieValues.set(`bpv_${board.id}`, createBoardPasswordVerificationSignature(board.id, board.passwordHash));
}

test("실제 손님 API의 비밀번호·동결 경계", async (t) => {
const routes = [
  { name: "글 생성", mod: await import("../app/api/sections/[sectionId]/posts/route"), method: "POST", params: { sectionId: post.sectionId }, body: { title: "제목", body: "본문" } },
  { name: "글 수정", mod: await import("../app/api/posts/[postId]/route"), method: "PATCH", params: { postId: post.id }, body: { body: "수정", version: 1 } },
  { name: "글 삭제", mod: await import("../app/api/posts/[postId]/route"), method: "DELETE", params: { postId: post.id } },
  { name: "사진 업로드", mod: await import("../app/api/posts/[postId]/attachments/route"), method: "POST", params: { postId: post.id } },
  { name: "사진 순서", mod: await import("../app/api/posts/[postId]/attachments/reorder/route"), method: "POST", params: { postId: post.id }, body: { attachmentIds: ["test-attachment"] } },
  { name: "사진 삭제", mod: await import("../app/api/attachments/[attachmentId]/route"), method: "DELETE", params: { attachmentId: "test-attachment" } },
  { name: "댓글 생성", mod: await import("../app/api/posts/[postId]/comments/route"), method: "POST", params: { postId: post.id }, body: { body: "댓글" } },
  { name: "댓글 수정", mod: await import("../app/api/comments/[commentId]/route"), method: "PATCH", params: { commentId: comment.id }, body: { body: "수정" } },
  { name: "댓글 삭제", mod: await import("../app/api/comments/[commentId]/route"), method: "DELETE", params: { commentId: comment.id } },
  { name: "댓글 사진", mod: await import("../app/api/comments/[commentId]/attachments/route"), method: "POST", params: { commentId: comment.id } },
];
for (const scope of ["PUBLIC", "LINK"]) {
 for (const authenticated of [false, true]) {
  signedIn = authenticated;
  post.authorId = comment.authorId = comment.post.authorId = attachment.post.authorId = authenticated ? "visitor" : null;
  post.guestId = comment.guestId = comment.post.guestId = attachment.post.guestId = authenticated ? null : "guest-a";
  for (const route of routes) {
    await t.test(`${scope} ${authenticated ? "로그인 방문자" : "손님"} ${route.name}: 비밀번호·동결`, async () => {
      board.discoveryScope = scope;
      const handler = (route.mod as unknown as Record<string, (request: Request, context: { params: Promise<unknown> }) => Promise<Response>>)[route.method];
      assert.ok(handler, `${route.name} 메서드가 존재해야 합니다.`);
      for (const verified of [false, true]) {
        prepareCookies(verified);
        const request = new Request("http://localhost/api/test", { method: route.method,
          headers: { "Content-Type": "application/json" }, body: route.body ? JSON.stringify(route.body) : undefined });
        const response = await handler(request, { params: Promise.resolve(route.params) });
        assert.equal(response.status, verified ? 409 : 403, await response.text());
      }
    });
  }
 }
}
signedIn = false;
const guestRoute = await import("../app/api/boards/[boardId]/guest/route");
await t.test("손님 세션도 비밀번호 검증 전에는 발급하지 않는다", async () => {
  board.discoveryScope = "PUBLIC";
  prepareCookies(false);
  const response = await guestRoute.POST(new Request("http://localhost/api/test", { method: "POST", body: JSON.stringify({ name: "손님" }) }), { params: Promise.resolve({ boardId: board.id }) });
  assert.equal(response.status, 403);
});
signedIn = true;
board.discoveryScope = "LINK";
post.authorId = comment.authorId = comment.post.authorId = attachment.post.authorId = "visitor";
post.deletedAt = comment.deletedAt = attachment.deletedAt = new Date();
const recoveryRoutes = [
  { mod: await import("../app/api/posts/[postId]/restore/route"), method: "POST", params: { postId: post.id }, name: "글 복구" },
  { mod: await import("../app/api/comments/[commentId]/restore/route"), method: "POST", params: { commentId: comment.id }, name: "댓글 복구" },
  { mod: await import("../app/api/admin/posts/[postId]/purge/route"), method: "DELETE", params: { postId: post.id }, name: "글 영구 삭제" },
  { mod: await import("../app/api/admin/comments/[commentId]/purge/route"), method: "DELETE", params: { commentId: comment.id }, name: "댓글 영구 삭제" },
  { mod: await import("../app/api/admin/attachments/[attachmentId]/purge/route"), method: "DELETE", params: { attachmentId: attachment.id }, name: "사진 영구 삭제" },
];
for (const route of recoveryRoutes) {
  await t.test(`LINK 방문자 ${route.name}도 비밀번호·동결 경계 적용`, async () => {
    const handler = (route.mod as unknown as Record<string, (r: Request, c: { params: Promise<unknown> }) => Promise<Response>>)[route.method];
    for (const verified of [false, true]) {
      prepareCookies(verified);
      const response = await handler(new Request("http://localhost/api/test", { method: route.method }), { params: Promise.resolve(route.params) });
      assert.equal(response.status, verified ? 409 : 403, await response.text());
    }
  });
}
await t.test("LINK 손님이 실제 생성·수정 API로 승인 대기 글을 저장한다", async () => {
  signedIn = false; board.state = "ACTIVE";
  post.deletedAt = null; post.authorId = null; post.guestId = "guest-a";
  prepareCookies(true); acceptingWrites = true;
  try {
    const create = await import("../app/api/sections/[sectionId]/posts/route");
    const created = await create.POST(new Request("http://localhost/api/test", { method: "POST", body: JSON.stringify({ title: "손님 글", body: "처음 본문" }) }), { params: Promise.resolve({ sectionId: post.sectionId }) });
    assert.equal(created.status, 201, await created.clone().text());
    assert.equal((await created.json()).post.status, "PENDING");
    const update = await import("../app/api/posts/[postId]/route");
    const edited = await update.PATCH(new Request("http://localhost/api/test", { method: "PATCH", body: JSON.stringify({ body: "수정한 본문", version: post.version }) }), { params: Promise.resolve({ postId: post.id }) });
    assert.equal(edited.status, 200, await edited.clone().text());
    assert.equal((await edited.json()).post.body, "수정한 본문");
    const pinned = await update.PATCH(new Request("http://localhost/api/test", { method: "PATCH", body: JSON.stringify({ isPinned: false, version: post.version }) }), { params: Promise.resolve({ postId: post.id }) });
    assert.equal(pinned.status, 403, "손님에게 고정 권한을 주면 안 됩니다.");
    board.visitorPermission = "READER";
    const disabled = await update.PATCH(new Request("http://localhost/api/test", { method: "PATCH", body: JSON.stringify({ body: "쓰기를 끈 후", version: post.version }) }), { params: Promise.resolve({ postId: post.id }) });
    assert.equal(disabled.status, 403);
  } finally { acceptingWrites = false; }
});
});
