import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";

const root = process.cwd();
const read = (relativePath: string) => readFile(path.join(root, relativePath), "utf8");

async function routeFiles(directory: string): Promise<string[]> {
  const entries = await readdir(path.join(root, directory), { withFileTypes: true });
  const nested = await Promise.all(entries.map(async (entry) => {
    const relativePath = path.join(directory, entry.name);
    if (entry.isDirectory()) return routeFiles(relativePath);
    return entry.name === "route.ts" ? [relativePath] : [];
  }));
  return nested.flat();
}

async function main() {
  const routes = await routeFiles("app/api");
  const sources = await Promise.all(routes.map(async (file) => ({ file, source: await read(file) })));
  const mutationHandlers = sources.flatMap(({ file, source }) => {
    const handlers = [...source.matchAll(/export async function (GET|POST|PUT|PATCH|DELETE)\s*\(/g)];
    return handlers.flatMap((handler, index) => {
      const method = handler[1];
      if (method === "GET") return [];
      const body = source.slice(handler.index, handlers[index + 1]?.index ?? source.length);
      return [{ file, method, body }];
    });
  });
  const missingOrigin = mutationHandlers
    .filter(({ body }) => !/assertSameOrigin\(_?request\)/.test(body))
    .map(({ file, method }) => `${method} ${file}`);
  assert.deepEqual(missingOrigin, [], `same-origin 검사가 없는 쓰기 API: ${missingOrigin.join(", ")}`);

  const publicUnboundedJson = sources
    .filter(({ file, source }) => file.startsWith(path.join("app", "api", "public")) && source.includes("request.json("))
    .map(({ file }) => file);
  assert.deepEqual(publicUnboundedJson, [], `본문 상한 없이 JSON을 읽는 공개 API: ${publicUnboundedJson.join(", ")}`);

  const [
    http,
    authJoin,
    publicJoin,
    register,
    loginIdCheck,
    groupMembers,
    subjectInvite,
    subjectResources,
    grading,
    policyShape,
    identitySchema,
    migration,
    socketMigration,
    adminSettings,
  ] = await Promise.all([
    read("lib/http.ts"),
    read("app/api/quiz/sessions/join/route.ts"),
    read("app/api/public/sessions/join/route.ts"),
    read("app/api/auth/register/route.ts"),
    read("app/api/auth/register/check-login-id/route.ts"),
    read("app/api/boards/[boardId]/members/groups/route.ts"),
    read("lib/board/subject-invite.ts"),
    read("app/api/subjects/[subjectId]/resources/route.ts"),
    read("lib/quiz/grading.ts"),
    read("lib/security/platform-policy-shape.ts"),
    read("prisma/schema/identity.prisma"),
    read("prisma/migrations/20260817010000_raise_classroom_quiz_join_limit/migration.sql"),
    read("prisma/migrations/20260818020000_raise_public_quiz_ip_connection_limit/migration.sql"),
    read("app/api/admin/settings/route.ts"),
  ]);

  assert(http.includes("InvalidJsonBodyError") && http.includes("JsonBodyTooLargeError"), "JSON 400/413 오류 경계가 사라졌습니다.");
  assert(http.includes("return errorResponse(fallback, 500)") && http.includes('"Cache-Control": "private, no-store"'), "내부 오류 500 또는 비캐시 오류 응답 규칙이 사라졌습니다.");

  const authRequiredAt = authJoin.indexOf("await requireRole");
  const authRateAt = authJoin.indexOf("assertRateLimit(request");
  assert(authRequiredAt >= 0 && authRateAt > authRequiredAt && authJoin.includes("userId: actor.id"), "로그인 퀴즈 참여 제한은 인증 뒤 계정 단위여야 합니다.");
  assert(publicJoin.includes("readJsonWithLimit") && publicJoin.includes("assertPublicQuizInvalidPinRateLimit"), "공개 퀴즈 참여의 본문 상한 또는 잘못된 PIN 제한이 사라졌습니다.");
  assert(policyShape.includes("publicQuizJoinPerMinute: 120") && identitySchema.includes("@default(120)") && migration.includes('SET "publicQuizJoinPerMinute" = 120'), "교실 NAT용 공개 퀴즈 참여 기본값이 스키마·정책·마이그레이션에서 어긋났습니다.");
  assert(policyShape.includes("publicQuizSocketConnectionsPerIp: 200") && identitySchema.includes("publicQuizSocketConnectionsPerIp           Int @default(200)") && socketMigration.includes('SET "publicQuizSocketConnectionsPerIp" = 200'), "학교 NAT용 공개 소켓 기본값이 스키마·정책·마이그레이션에서 어긋났습니다.");
  assert(adminSettings.includes("readJsonWithLimit(request, SETTINGS_BODY_MAX_BYTES)") && adminSettings.includes("prisma.$transaction"), "관리자 정책 저장은 본문 상한과 설정·감사 원자성을 함께 가져야 합니다.");

  assert(register.indexOf("const attempt = await prepareRegistrationAttempt") < register.indexOf("const availability = await registrationLoginIdAvailability"), "회원가입은 제한 검사 뒤 아이디 존재 여부를 조회해야 합니다.");
  assert(loginIdCheck.indexOf("const limit = await prepareLoginIdAvailabilityCheck") < loginIdCheck.indexOf("const availability = await registrationLoginIdAvailability"), "아이디 중복 확인은 제한 검사 뒤 존재 여부를 조회해야 합니다.");

  assert(groupMembers.includes("followBoardUsers") && groupMembers.includes("if (addedCount)"), "그룹 멤버 추가 부수효과가 실제 추가 건수와 일괄 팔로우를 사용해야 합니다.");
  assert(subjectInvite.includes("if (!addedCount)") && subjectInvite.includes("followBoardUsers"), "교과목 명단 초대가 경쟁 요청에서 중복 활동을 만들면 안 됩니다.");
  assert(subjectResources.includes("new Set(boardIds)") && subjectResources.includes("BOARD_INVITE_CONCURRENCY"), "교과목 패드 초대는 중복 제거와 제한된 병렬성을 유지해야 합니다.");

  assert(grading.includes('error.code !== "P2002"') && grading.includes("alreadyAnswered: true"), "답안 중복 제출 경쟁은 저장된 승자 결과로 수렴해야 합니다.");

  for (const relativePath of [
    "app/api/me/route.ts",
    "app/api/me/login-id/route.ts",
    "app/api/me/password/route.ts",
    "app/api/me/nickname-availability/route.ts",
  ]) {
    const source = await read(relativePath);
    assert(source.includes("readJsonWithLimit") && !source.includes("request.json("), `${relativePath}가 본문 상한 없는 JSON 읽기로 돌아갔습니다.`);
  }

  console.log(`api_boundary_checks=passed routes=${routes.length} mutations=${mutationHandlers.length}`);
}

void main().catch((error) => {
  console.error(error instanceof Error ? error.message : "API 경계 검증에 실패했습니다.");
  process.exitCode = 1;
});
