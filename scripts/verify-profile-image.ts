import assert from "node:assert/strict";
import { afterEach, beforeEach, mock, test } from "node:test";
import type { PrismaClient } from "../generated/prisma/client";
import { authOptions } from "../lib/auth/auth-options";
import { toPublicAuthorDTO } from "../lib/users/repository";
import { decryptOptionalUserPii, encryptOptionalUserPii } from "../lib/security/pii-crypto-core";

// 이 프로세스에서만 쓰는 fixture 키와 가짜 DB입니다. 운영 환경 파일/API/DB 접근 없음.
process.env.PII_ACTIVE_KEY_ID = "profile_image_test";
process.env.PII_ENCRYPTION_KEY_PROFILE_IMAGE_TEST = Buffer.alloc(32, 17).toString("base64");
process.env.PII_LOOKUP_KEY = Buffer.alloc(32, 19).toString("base64");
process.env.BOOTSTRAP_SUPER_ADMIN_EMAIL = "profile-image@example.org";

const cases = [
  ["실제 사용 중인 img1", "http://img1.kakaocdn.net/profile/photo.jpg?size=640#photo", "https://img1.kakaocdn.net/profile/photo.jpg?size=640#photo"],
  ["기존 k 호스트", "http://k.kakaocdn.net/profile/photo.jpg", "https://k.kakaocdn.net/profile/photo.jpg"],
  ["대문자 스킴·호스트", "HTTP://IMG1.KAKAOCDN.NET/Profile.jpg", "https://img1.kakaocdn.net/Profile.jpg"],
  ["이미 HTTPS", "https://img1.kakaocdn.net/photo.jpg?size=640", "https://img1.kakaocdn.net/photo.jpg?size=640"],
  ["직접 업로드한 사진", "/api/users/fixture/avatar?v=3", "/api/users/fixture/avatar?v=3"],
  ["다른 이미지 호스트", "http://images.example.org/photo.jpg", "http://images.example.org/photo.jpg"],
  ["접두어가 같은 다른 도메인", "http://k.kakaocdn.net.example.org/photo.jpg", "http://k.kakaocdn.net.example.org/photo.jpg"],
  ["사용자 정보로 위장한 호스트", "http://k.kakaocdn.net@images.example.org/photo.jpg", "http://k.kakaocdn.net@images.example.org/photo.jpg"],
  ["비표준 포트", "http://img1.kakaocdn.net:8080/photo.jpg", "http://img1.kakaocdn.net:8080/photo.jpg"],
  ["미리보기 blob", "blob:https://pyxis.example.org/photo", "blob:https://pyxis.example.org/photo"],
  ["사진 없음", null, null],
] as const;

for (const [label, storedImage, expected] of cases) {
  test(`기존 프로필 읽기: ${label}`, () => {
    const user = { id: "profile-reader", nameEncrypted: null, imageEncrypted: encryptOptionalUserPii("profile-reader", "image", storedImage) };
    const originalCiphertext = user.imageEncrypted;
    assert.equal(toPublicAuthorDTO(user).image, expected);
    assert.equal(user.imageEncrypted, originalCiphertext, "기존 암호문을 수정하지 않음");
  });
}

beforeEach(() => {
  mock.method(globalThis, "fetch", async () => new Response(null, { headers: { "content-type": "image/jpeg" } }));
});
afterEach(() => mock.restoreAll());

async function signUp(inputImage: string | null) {
    const state = globalThis as typeof globalThis & { pyxCoursePrisma?: PrismaClient };
    const original = state.pyxCoursePrisma;
    let savedImage: string | null | undefined;
    state.pyxCoursePrisma = { user: {
      findUnique: async () => null,
      create: async ({ data }: { data: { id: string; imageEncrypted: string | null } }) => {
        savedImage = decryptOptionalUserPii(data.id, "image", data.imageEncrypted);
        return { id: data.id, status: "ACTIVE", authVersion: 1, mustChangePassword: false, registrationApprovalStatus: "APPROVED", onboardingCompletedAt: null, teacherApprovalRequest: null };
      },
    } } as unknown as PrismaClient;
    try {
      await authOptions.callbacks.jwt({ token: {}, user: { id: "kakao-fixture", email: "profile-image@example.org", image: inputImage }, account: { provider: "kakao", type: "oauth", providerAccountId: "kakao-fixture" } });
      return savedImage;
    } finally {
      state.pyxCoursePrisma = original;
    }
}

const signupCases = [
  ["HTTP img1", "http://img1.kakaocdn.net/photo.jpg", "https://img1.kakaocdn.net/photo.jpg"],
  ["HTTP k", "http://k.kakaocdn.net/photo.jpg", "https://k.kakaocdn.net/photo.jpg"],
  ["대문자", "HTTP://IMG1.KAKAOCDN.NET/Photo.jpg", "https://img1.kakaocdn.net/Photo.jpg"],
  ["HTTPS", "https://img1.kakaocdn.net/photo.jpg", "https://img1.kakaocdn.net/photo.jpg"],
  ["이미지 없음", null, null],
  ["외부 호스트", "http://images.example.org/photo.jpg", null],
  ["위장 도메인", "http://k.kakaocdn.net.example.org/photo.jpg", null],
  ["위장 사용자 정보", "http://k.kakaocdn.net@images.example.org/photo.jpg", null],
  ["비표준 포트", "http://img1.kakaocdn.net:8080/photo.jpg", null],
  ["잘못된 URL", "not-an-image-url", null],
] as const;

for (const [label, inputImage, expected] of signupCases) {
  test(`새 카카오 프로필 저장: ${label}`, async () => {
    const requests: { url: string; options?: RequestInit }[] = [];
    mock.method(globalThis, "fetch", async (url: string, options?: RequestInit) => {
      requests.push({ url, options });
      return new Response(null, { headers: { "content-type": "image/jpeg" } });
    });
    assert.equal(await signUp(inputImage), expected);
    assert.deepEqual(requests.map(request => request.url), expected ? [expected] : [], "허용된 HTTPS 주소만 검사");
    if (requests.length) {
      assert.equal(requests[0].options?.method, "HEAD");
      assert.equal(requests[0].options?.redirect, "error", "외부/HTTP 리디렉션을 따라가지 않음");
      assert.ok(requests[0].options?.signal instanceof AbortSignal, "가입을 막지 않는 검사 시간 제한");
    }
  });
}

for (const [label, response] of [
  ["없는 사진", () => new Response(null, { status: 404 })],
  ["서버 오류", () => new Response(null, { status: 503 })],
  ["이미지가 아닌 응답", () => new Response("error", { headers: { "content-type": "text/html" } })],
  ["리디렉션", () => new Response(null, { status: 302, headers: { location: "http://127.0.0.1/" } })],
  ["네트워크 오류", () => { throw new TypeError("fetch failed"); }],
  ["시간 초과", () => { throw new DOMException("Timed out", "TimeoutError"); }],
] as const) {
  test(`HTTPS 확인 실패 시 가입을 막지 않고 기본 아바타 저장: ${label}`, async () => {
    mock.method(globalThis, "fetch", async () => response());
    assert.equal(await signUp("http://img1.kakaocdn.net/photo.jpg"), null);
  });
}

test("기존 카카오 계정은 재로그인 시 사용자 사진을 덮어쓰거나 이미지 검사를 기다리지 않음", async () => {
  const state = globalThis as typeof globalThis & { pyxCoursePrisma?: PrismaClient };
  const original = state.pyxCoursePrisma;
  let updatedFields: string[] = [];
  let requests = 0;
  mock.method(globalThis, "fetch", async () => { requests += 1; throw new Error("image unavailable"); });
  state.pyxCoursePrisma = { user: {
    findUnique: async () => ({ id: "existing" }),
    update: async ({ data }: { data: Record<string, unknown> }) => {
      updatedFields = Object.keys(data);
      return { id: "existing", status: "ACTIVE", authVersion: 1, mustChangePassword: false, registrationApprovalStatus: "APPROVED", onboardingCompletedAt: null, teacherApprovalRequest: null };
    },
  } } as unknown as PrismaClient;
  try {
    const token = await authOptions.callbacks.jwt({ token: {}, user: { id: "kakao-fixture", email: "profile-image@example.org", image: "http://img1.kakaocdn.net/new.jpg" }, account: { provider: "kakao", type: "oauth", providerAccountId: "kakao-fixture" } });
    assert.equal(token.userId, "existing");
    assert.deepEqual(updatedFields.sort(), ["lastLoginAt", "loginIdentifierEncrypted"]);
    assert.equal(requests, 0);
  } finally {
    state.pyxCoursePrisma = original;
  }
});
