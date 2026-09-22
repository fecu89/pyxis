// Real registration routes and OAuth callbacks; only storage, provider I/O and request context are fixtures.
import assert from "node:assert/strict";
import test from "node:test";
import { createRequire } from "node:module";
import { build } from "esbuild";
const require = createRequire(import.meta.url);
const mocks = {
  "server-only": "",
  "next/headers": "export const cookies=async()=>({get:name=>globalThis.consentFixture.cookies.get(name)});",
  "next-auth": "export default ()=>async()=>new Response(null,{status:302,headers:{location:'/dashboard'}});",
  "@/generated/prisma/client": "export const Prisma={PrismaClientKnownRequestError:class extends Error{}};",
  "@/lib/prisma": "export const getPrisma=()=>globalThis.consentFixture.db;",
  "@/lib/auth/authorization": "export class AuthorizationError extends Error{};export const requireActiveUser=async()=>({id:'fixture-user'});",
  "@/lib/auth/current-user": "export class AuthenticationError extends Error{};",
  "@/lib/auth/password": "export const hashUserPassword=async()=> 'fixture-hash';export const verifyUserPassword=async()=>true;",
  "@/lib/auth/security": "export const prepareRegistrationAttempt=async()=>({allowed:true,ipLookup:'fixture-ip'});export const recordRegistrationResult=async()=>{};export const prepareCredentialAttempt=async()=>({allowed:true});export const recordCredentialFailure=async()=>{};export const recordCredentialSuccess=async()=>{};",
  "@/lib/auth/registration": "export const registrationLoginIdAvailability=async()=>({available:true,normalized:'fixtureuser',loginIdentifierLookup:'fixture-lookup'});",
  "@/lib/security/pii-crypto": "export const normalizeLoginIdentifier=v=>v.trim().toLowerCase();export const normalizeEmail=normalizeLoginIdentifier;export const createLoginIdentifierLookup=v=>'lookup:'+v;export const encryptUserLoginIdentifier=(id,v)=>'encrypted:'+v;export const encryptUserPii=(id,field,v)=>'encrypted:'+v;export const encryptOptionalUserPii=encryptUserPii;export const decryptOptionalUserPii=()=>null;",
  "@/lib/security/rate-limit": "export class RateLimitError extends Error{};",
  "@/lib/users/registration-approvals": "export const notifyRegistrationApprovalRequested=async()=>{};",
  "@/lib/users/kakao-profile-image": "export const resolveKakaoProfileImage=async()=>null;",
  "@/lib/users/nickname": "import {z} from 'zod';export const nicknameSchema=z.string();export const isNicknameAvailable=async()=>({available:true,nameLookup:'fixture'});export const isNicknameUniqueConflict=()=>false;",
  "@/lib/board/succession": "export const succeedOwnedBoards=async()=>[];export const summarizeSuccessions=()=>({});",
  "@/lib/files/paths": "export const getAvatarPath=()=>'/tmp/unused-consent-fixture';",
  "node:fs/promises": "export const unlink=async()=>{};",
};
export async function loadConsentModule(entry) {
  const output = await build({ stdin: { contents: `export * from ${JSON.stringify(entry)};`, resolveDir: process.cwd() }, bundle: true, write: false, platform: "node", format: "cjs", packages: "external",
    define: { "process.env.AUTH_SECRET": JSON.stringify("only-a-fixture-consent-secret-never-a-real-key"), "process.env.APP_ORIGINS": '"https://fixture.local"' },
    plugins: [{ name: "storage-boundaries", setup(b) {
      b.onResolve({ filter: /.*/ }, args => Object.hasOwn(mocks, args.path) ? { path: args.path, namespace: "fixture" } : undefined);
      b.onLoad({ filter: /.*/, namespace: "fixture" }, args => ({ contents: mocks[args.path], resolveDir: process.cwd() }));
    } }],
  });
  const loadedModule = { exports: {} };
  new Function("require", "module", "exports", output.outputFiles[0].text)(require, loadedModule, loadedModule.exports);
  return loadedModule.exports;
}
const register = await loadConsentModule("@/app/api/auth/register/route");
const { authOptions } = await loadConsentModule("@/lib/auth/auth-options");
const account = await loadConsentModule("@/app/api/me/route");
const consentRoute = await loadConsentModule("@/app/api/auth/signup-consent/route");
const oauthRoute = await loadConsentModule("@/app/api/auth/[...nextauth]/route");
const { proxy } = await loadConsentModule("@/proxy");
const { NextRequest } = require("next/server");
const { encode } = require("next-auth/jwt");
const accepted = { terms: true, privacy: true, age14: true, termsVersion: "2026-09-22", privacyVersion: "2026-09-22" };
function fixture(existing = null) {
  const writes = [];
  const db = { user: {
    findUnique: async () => existing,
    create: async ({ data }) => { writes.push(data); return { ...data, status: "ACTIVE", authVersion: 1, mustChangePassword: false, onboardingCompletedAt: null, teacherApprovalRequest: null }; },
    update: async ({ data }) => { writes.push(data); return { id: "fixture-user", ...data, status: "ACTIVE", authVersion: 1, mustChangePassword: false, registrationApprovalStatus: "APPROVED", onboardingCompletedAt: new Date(), teacherApprovalRequest: null }; },
  }, $transaction: async fn => fn(db) };
  globalThis.consentFixture = { db, cookies: new Map() };
  return writes;
}
const request = body => new Request("https://fixture.local/api/auth/register", { method: "POST", headers: { origin: "https://fixture.local", "content-type": "application/json" }, body: JSON.stringify({ loginId: "fixtureuser", password: "ClearSky72!", passwordConfirm: "ClearSky72!", ...body }) });
const kakao = { user: { email: "fixture@example.invalid", name: "fixture" }, account: { provider: "kakao" }, profile: { kakao_account: { is_email_valid: true, is_email_verified: true } } };

test("일반 가입은 필수 동의 누락/거부/옛 버전을 계정 생성 전에 거절한다", async () => {
  for (const consent of [undefined, { ...accepted, age14: false }, { ...accepted, privacy: false }, { ...accepted, terms: false }, { ...accepted, termsVersion: "old" }, { ...accepted, age14: "true" }]) {
    const writes = fixture();
    assert.equal((await register.POST(request({ consent }))).status, 400);
    assert.equal(writes.length, 0);
  }
});
test("일반 가입은 동의 시각과 문서 버전·14세 확인을 계정과 함께 저장한다", async () => {
  const writes = fixture();
  assert.equal((await register.POST(request({ consent: accepted }))).status, 201);
  assert.equal(writes.length, 1);
  assert.equal(writes[0].termsVersion, "2026-09-22");
  assert.equal(writes[0].privacyVersion, "2026-09-22");
  assert.equal(writes[0].age14Confirmed, true);
  assert(writes[0].registrationConsentAt instanceof Date);
});
test("카카오 신규 가입은 동의 없으면 로그인 완료/계정 생성을 허용하지 않는다", async () => {
  const writes = fixture();
  assert.match(await authOptions.callbacks.signIn(kakao), /^\/login\?signup=required/);
  await assert.rejects(() => authOptions.callbacks.jwt({ ...kakao, token: {} }), /동의/);
  assert.equal(writes.length, 0);
});
test("기존 카카오 회원은 새 가입 동의 없이 로그인하되 동의를 소급 작성하지 않는다", async () => {
  const writes = fixture({ id: "existing", status: "ACTIVE", authVersion: 1 });
  assert.equal(await authOptions.callbacks.signIn(kakao), true);
  const token = await authOptions.callbacks.jwt({ ...kakao, token: {} });
  assert.equal(token.sessionInvalid, false);
  assert.equal("registrationConsentAt" in writes[0], false);
});
test("탈퇴 시 원래 로그인 식별자 암호문을 삭제용 값으로 교체한다", async () => {
  const writes = fixture({ schoolId: "fixture-school" });
  assert.equal((await account.DELETE(new Request("https://fixture.local/api/me", { method: "DELETE" }))).status, 200);
  assert.match(writes[0].loginIdentifierEncrypted ?? "", /^encrypted:deleted-/);
  assert.match(writes[0].loginIdentifierLookup, /^deleted:/);
});

test("카카오 동의 쿠키를 검증하고 가입 시각·버전을 신규 계정에 저장한다", async () => {
  const writes = fixture();
  const response = await consentRoute.POST(new Request("https://fixture.local/api/auth/signup-consent", { method: "POST", headers: { origin: "https://fixture.local", "content-type": "application/json" }, body: JSON.stringify(accepted) }));
  assert.equal(response.status, 200);
  const cookie = response.headers.get("set-cookie");
  assert.match(cookie, /HttpOnly/i);
  assert.match(cookie, /SameSite=lax/i);
  assert.match(cookie, /Max-Age=900/i);
  assert.match(cookie, /Path=\/api\/auth/i);
  globalThis.consentFixture.cookies.set("pyxis-signup-consent", { value: cookie.split(";")[0].split("=")[1] });
  assert.equal(await authOptions.callbacks.signIn(kakao), true);
  const token = await authOptions.callbacks.jwt({ ...kakao, token: {} });
  assert.equal(token.sessionInvalid, false);
  assert.equal(writes[0].privacyVersion, "2026-09-22");
  assert.equal(writes[0].termsVersion, "2026-09-22");
  assert.equal(writes[0].age14Confirmed, true);
  assert(writes[0].registrationConsentAt instanceof Date);
});

test("카카오 동의 누락·위조·만료·옛 버전 및 일반 세션 토큰을 거부한다", async () => {
  for (const value of ["forged", await encode({ secret: "only-a-fixture-consent-secret-never-a-real-key", salt: "pyxis-signup-consent-v1", maxAge: -60, token: { purpose: "signup-consent", consent: accepted, acceptedAt: Date.now() - 1000000 } }),
    await encode({ secret: "only-a-fixture-consent-secret-never-a-real-key", salt: "pyxis-signup-consent-v1", token: { purpose: "signup-consent", consent: { ...accepted, privacyVersion: "old" }, acceptedAt: Date.now() } }),
    await encode({ secret: "only-a-fixture-consent-secret-never-a-real-key", token: { purpose: "signup-consent", consent: accepted, acceptedAt: Date.now() } })]) {
    const writes = fixture();
    globalThis.consentFixture.cookies.set("pyxis-signup-consent", { value });
    assert.match(await authOptions.callbacks.signIn(kakao), /^\/login\?signup=required/);
    await assert.rejects(() => authOptions.callbacks.jwt({ ...kakao, token: {} }), /동의/);
    assert.equal(writes.length, 0);
  }
});

test("동의 티켓은 항목 누락과 외부 출처 요청에 발급하지 않는다", async () => {
  fixture();
  for (const [origin, body, status] of [["https://fixture.local", { ...accepted, terms: false }, 400], ["https://attacker.invalid", accepted, 403]]) {
    const response = await consentRoute.POST(new Request("https://fixture.local/api/auth/signup-consent", { method: "POST", headers: { origin, "content-type": "application/json" }, body: JSON.stringify(body) }));
    assert.equal(response.status, status);
    assert.equal(response.headers.get("set-cookie"), null);
  }
});

test("동의 화면으로 돌아갈 때 내부 목적지는 보존하고 외부 목적지는 거절한다", async () => {
  fixture();
  globalThis.consentFixture.cookies.set("next-auth.callback-url", { value: "https://fixture.local/dashboard?subjectId=science" });
  const redirect = new URL(await authOptions.callbacks.signIn(kakao), "https://fixture.local");
  assert.equal(redirect.searchParams.get("callbackUrl"), "/dashboard?subjectId=science");
  globalThis.consentFixture.cookies.set("next-auth.callback-url", { value: "https://attacker.invalid/trap" });
  assert.equal(new URL(await authOptions.callbacks.signIn(kakao), "https://fixture.local").searchParams.get("callbackUrl"), "/dashboard");
});

test("가입을 진행하지 않는 로그인 및 OAuth 콜백 뒤에는 남은 동의 쿠키를 지운다", async () => {
  fixture();
  assert.equal(typeof consentRoute.DELETE, "function");
  const canceled = await consentRoute.DELETE(new Request("https://fixture.local/api/auth/signup-consent", { method: "DELETE" }));
  assert.match(canceled.headers.get("set-cookie"), /Max-Age=0/i);
  const completed = await oauthRoute.GET(new NextRequest("https://fixture.local/api/auth/callback/kakao"), { params: Promise.resolve({ nextauth: ["callback", "kakao"] }) });
  assert.match(completed.headers.get("set-cookie"), /pyxis-signup-consent=.*Max-Age=0/i);
});

test("약관은 비밀번호 변경·온보딩·가입 승인 상태와 관계없이 읽을 수 있다", async () => {
  for (const state of ["PROFILE", "TEACHER_PENDING", "ACCOUNT_PENDING", "COMPLETE"]) {
    const value = await encode({ secret: "only-a-fixture-consent-secret-never-a-real-key", token: { userId: "fixture-user", onboardingState: state, passwordChangeRequired: state === "COMPLETE" } });
    for (const path of ["/terms", "/privacy"]) {
      const response = await proxy(new NextRequest(`https://fixture.local${path}`, { headers: { cookie: `next-auth.session-token=${value}; __Secure-next-auth.session-token=${value}` } }));
      assert.equal(response.headers.get("location"), null, `${path} should be public for ${state}`);
      assert.equal(response.headers.get("x-middleware-next"), "1");
    }
  }
});
