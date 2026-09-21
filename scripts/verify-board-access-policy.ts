import "../lib/load-env";
import assert from "node:assert/strict";
import { getPrisma } from "../lib/prisma";
import { getBoardPageData } from "../lib/board/queries";
import { getBoardAccess } from "../lib/board/permissions";
import { normalizeBoardAccessSettings } from "../lib/board/validators";
import { getPrivateUserDTO } from "../lib/users/repository";
import { hashBoardPassword } from "../lib/board/board-password";
import { createLoginIdentifierLookup, encryptUserPii } from "../lib/security/pii-crypto-core";
import {
  canComment,
  canCreatePost,
  canDeleteComment,
  canEditComment,
  canEditPost,
  canReact,
  canUploadFile,
} from "../lib/auth/authorization";
import { createPadActivity } from "./fixtures";

// padupgrade.md 4.2 완료 조건: "비로그인·로그인·멤버·관리자 조합별 권한 테스트"를
// discoveryScope × visitorPermission × loginRequired × 멤버십 조합으로 직접 검증합니다.
// getBoardPageData는 "server-only"를 import하지만, 이 패키지는 브라우저 번들 조건에서만
// 에러를 던지므로 순수 Node(tsx) 실행에서는 그냥 통과합니다 — verify-admin-http.ts처럼
// HTTP 레이어를 거치지 않고 DAL 함수를 직접 호출해 로그인 리다이렉트·쿠키 없이 검증합니다.

type Combo = {
  label: string;
  discoveryScope: "PRIVATE" | "LINK" | "PUBLIC";
  visitorPermission: "NO_ACCESS" | "READER" | "COMMENTER" | "WRITER";
  loginRequired: boolean;
  passwordHash?: string | null;
  as: "anonymous" | "nonMember" | "member" | "owner";
  expectStatus: "login-required" | "access-required" | "password-required" | "ready";
  expectVisitorWrite?: boolean;
};

// 보드 멤버의 이메일은 소유자가 조회할 때(canManageBoard=true) 실제로 복호화되므로,
// 멤버로 등록할 임시 계정은 실제 PII 암호화 파이프라인으로 만들어야 합니다(더미 문자열이면 복호화가 깨짐).
async function createTempUser(prisma: ReturnType<typeof getPrisma>, label: string) {
  const email = `verify-access-${label}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@pyxpad.demo`;
  const created = await prisma.user.create({
    data: { loginIdentifierEncrypted: "", loginIdentifierLookup: createLoginIdentifierLookup(email), role: "STUDENT", status: "ACTIVE" },
    select: { id: true },
  });
  await prisma.user.update({ where: { id: created.id }, data: { loginIdentifierEncrypted: encryptUserPii(created.id, "email", email) } });
  return created.id;
}

async function main() {
  const prisma = getPrisma();
  const owner = await prisma.user.findFirst({ where: { role: "TEACHER", status: "ACTIVE" }, select: { id: true } });
  assert.ok(owner, "테스트용 활성 교사 계정이 필요합니다(npm run db:seed).");
  // seed 데이터 구성(학생 수 등)에 기대지 않도록, 멤버·비멤버 학생은 이 스크립트가 직접 만들고 끝에 정리합니다.
  const memberUserId = await createTempUser(prisma, "member");
  const outsiderUserId = await createTempUser(prisma, "outsider");

  const board = await prisma.board.create({
    data: {
      slug: `verify-access-policy-${Date.now()}`,
      title: "[검증용] 접근 정책 임시 보드",
      ownerId: owner.id,
      activityId: await createPadActivity(prisma, owner.id, "[검증용] 접근 정책 임시 보드"),
      discoveryScope: "PRIVATE",
      visitorPermission: "NO_ACCESS",
      loginRequired: true,
      members: { create: [{ userId: owner.id, role: "OWNER" }, { userId: memberUserId, role: "VIEWER" }] },
    },
    select: { id: true, slug: true },
  });

  try {
    const ownerDto = await getPrivateUserDTO(owner.id);
    const memberDto = await getPrivateUserDTO(memberUserId);
    const outsiderDto = await getPrivateUserDTO(outsiderUserId);
    assert.ok(ownerDto && memberDto && outsiderDto);

    const memberPasswordHash = await hashBoardPassword("secret1234");
    const combos: Combo[] = [
      { label: "PRIVATE/NO_ACCESS/loginRequired, 비로그인", discoveryScope: "PRIVATE", visitorPermission: "NO_ACCESS", loginRequired: true, as: "anonymous", expectStatus: "login-required" },
      { label: "PRIVATE/NO_ACCESS/loginRequired, 비멤버 로그인", discoveryScope: "PRIVATE", visitorPermission: "NO_ACCESS", loginRequired: true, as: "nonMember", expectStatus: "access-required" },
      { label: "PRIVATE는 방문자 권한을 완화해도 여전히 차단", discoveryScope: "PRIVATE", visitorPermission: "WRITER", loginRequired: false, as: "nonMember", expectStatus: "access-required" },
      { label: "과거 LINK/NO_ACCESS/loginRequired 데이터도 비로그인 읽기 허용", discoveryScope: "LINK", visitorPermission: "NO_ACCESS", loginRequired: true, as: "anonymous", expectStatus: "ready" },
      { label: "과거 LINK/READER/loginRequired 데이터도 비로그인 읽기 허용", discoveryScope: "LINK", visitorPermission: "READER", loginRequired: true, as: "anonymous", expectStatus: "ready" },
      { label: "과거 LINK/WRITER 데이터도 로그인 비멤버에게 읽기만 허용", discoveryScope: "LINK", visitorPermission: "WRITER", loginRequired: true, as: "nonMember", expectStatus: "ready", expectVisitorWrite: false },
      { label: "LINK/READER, 로그인 불필요, 비로그인", discoveryScope: "LINK", visitorPermission: "READER", loginRequired: false, as: "anonymous", expectStatus: "ready" },
      { label: "LINK/WRITER opt-in, 로그인 비멤버도 쓰기 허용", discoveryScope: "LINK", visitorPermission: "WRITER", loginRequired: false, as: "nonMember", expectStatus: "ready", expectVisitorWrite: true },
      { label: "PUBLIC/READER, 로그인 불필요, 비로그인", discoveryScope: "PUBLIC", visitorPermission: "READER", loginRequired: false, as: "anonymous", expectStatus: "ready" },
      { label: "PUBLIC이어도 NO_ACCESS면 비로그인은 로그인 요구로 처리", discoveryScope: "PUBLIC", visitorPermission: "NO_ACCESS", loginRequired: false, as: "anonymous", expectStatus: "login-required" },
      { label: "PUBLIC/WRITER 비멤버 쓰기 정책은 그대로 유지", discoveryScope: "PUBLIC", visitorPermission: "WRITER", loginRequired: true, as: "nonMember", expectStatus: "ready", expectVisitorWrite: true },
      { label: "PRIVATE + 비밀번호여도 VIEWER 멤버는 비밀번호 없이 통과", discoveryScope: "PRIVATE", visitorPermission: "NO_ACCESS", loginRequired: true, passwordHash: memberPasswordHash, as: "member", expectStatus: "ready" },
      { label: "보드 소유자는 어떤 제한 조합에서도 통과", discoveryScope: "PRIVATE", visitorPermission: "NO_ACCESS", loginRequired: true, as: "owner", expectStatus: "ready" },
    ];
    // password-required 경로(access.role===null && passwordHash 있음)는 hasVerifiedBoardPassword가
    // next/headers의 cookies()를 호출하는데, 이건 실제 요청 스코프 밖(이 tsx 스크립트)에서는 동작하지
    // 않는다("cookies was called outside a request scope"). 그래서 비멤버+비밀번호 조합은 여기서 빼고,
    // 이번 세션에서 curl로 수행한 수동 스모크 테스트(비멤버 접근 시 password-required, 소유자는 우회)로 대신 확인했다.

    for (const combo of combos) {
      await prisma.board.update({
        where: { id: board.id },
        data: {
          discoveryScope: combo.discoveryScope,
          visitorPermission: combo.visitorPermission,
          loginRequired: combo.loginRequired,
          passwordHash: combo.passwordHash ?? null,
        },
      });
      const currentUser = combo.as === "anonymous" ? null : combo.as === "owner" ? ownerDto : combo.as === "member" ? memberDto : outsiderDto;
      const result = await getBoardPageData(board.slug, currentUser);
      assert.equal(result.status, combo.expectStatus, `[${combo.label}] 기대: ${combo.expectStatus}, 실제: ${result.status}`);
      if (result.status === "ready" && combo.expectVisitorWrite !== undefined) {
        assert.equal(result.data.capabilities.createPost, combo.expectVisitorWrite, `[${combo.label}] 글쓰기 capability`);
        assert.equal(result.data.capabilities.comment, combo.expectVisitorWrite, `[${combo.label}] 댓글 capability`);
        assert.equal(result.data.capabilities.react, combo.expectVisitorWrite, `[${combo.label}] 반응 capability`);
        assert.equal(result.data.capabilities.editOwnContent, combo.expectVisitorWrite, `[${combo.label}] 자기 콘텐츠 수정 capability`);
      }
    }

    const normalizedLink = normalizeBoardAccessSettings({
      discoveryScope: "LINK" as const,
      visitorPermission: "WRITER" as const,
      loginRequired: true,
      untouched: "kept",
    });
    assert.deepEqual(normalizedLink, {
      discoveryScope: "LINK",
      visitorPermission: "WRITER",
      loginRequired: false,
      untouched: "kept",
    }, "LINK의 명시적 WRITER 설정은 유지하면서 로그인 없이 참여하도록 정규화");

    // 링크 공개 전환 전에 방문자로 쓴 예전 콘텐츠가 있더라도, 비멤버는 자신의 글·댓글까지
    // 수정하거나 지울 수 없어야 합니다. 명시적으로 초대된 멤버와 전역 관리자는 별도 역할로 판정됩니다.
    await prisma.board.update({
      where: { id: board.id },
      data: { discoveryScope: "LINK", visitorPermission: "WRITER", loginRequired: true, passwordHash: null },
    });
    const legacyLinkAccess = await getBoardAccess(board.id, outsiderDto.id);
    assert.ok(legacyLinkAccess);
    assert.equal(canCreatePost(outsiderDto, legacyLinkAccess), false);
    assert.equal(canUploadFile(outsiderDto, legacyLinkAccess), false);
    assert.equal(canComment(outsiderDto, legacyLinkAccess), false);
    assert.equal(canReact(outsiderDto, legacyLinkAccess), false);
    assert.equal(canEditPost({ user: outsiderDto, access: legacyLinkAccess, postAuthorId: outsiderDto.id }), false);
    assert.equal(canEditComment({ user: outsiderDto, access: legacyLinkAccess, commentAuthorId: outsiderDto.id }), false);
    assert.equal(canDeleteComment({ user: outsiderDto, access: legacyLinkAccess, commentAuthorId: outsiderDto.id }), false);

    console.log(`board_access_policy_checks=passed combos=${combos.length}`);
  } finally {
    await prisma.activity.deleteMany({ where: { board: { id: board.id } } });
    await prisma.user.deleteMany({ where: { id: { in: [memberUserId, outsiderUserId] } } });
  }
}

main()
  .catch((error) => {
    console.error(error instanceof Error ? error.message : "보드 접근 정책 검증에 실패했습니다.");
    process.exitCode = 1;
  })
  .finally(async () => {
    await getPrisma().$disconnect();
  });
