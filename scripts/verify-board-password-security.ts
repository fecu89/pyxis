import "../lib/load-env";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import {
  createBoardPasswordVerificationSignature,
  hashBoardPassword,
  verifyBoardPassword,
} from "@/lib/board/board-password";

async function main() {
  let eventLoopYielded = false;
  const tick = new Promise<void>((resolve) => setImmediate(() => {
    eventLoopYielded = true;
    resolve();
  }));
  const storedHash = await hashBoardPassword("secure-class-password");
  await tick;
  assert.equal(eventLoopYielded, true, "scrypt는 이벤트 루프를 양보해야 합니다.");
  assert.equal(await verifyBoardPassword("secure-class-password", storedHash), true);
  assert.equal(await verifyBoardPassword("wrong-password", storedHash), false);

  const originalSignature = createBoardPasswordVerificationSignature("board-1", storedHash);
  const rotatedHash = await hashBoardPassword("secure-class-password");
  assert.notEqual(originalSignature, createBoardPasswordVerificationSignature("board-1", rotatedHash));
  assert.notEqual(originalSignature, createBoardPasswordVerificationSignature("board-2", storedHash));

  const root = process.cwd();
  const revealRoute = readFileSync(path.join(root, "app/api/boards/[boardId]/password/route.ts"), "utf8");
  const patchRoute = readFileSync(path.join(root, "app/api/boards/[boardId]/route.ts"), "utf8");
  const verifyRoute = readFileSync(path.join(root, "app/api/boards/[boardId]/verify-password/route.ts"), "utf8");
  assert.match(revealRoute, /requireRecentAuthentication\(user, 30\)/);
  assert.match(revealRoute, /BOARD_PASSWORD_VIEWED/);
  assert.match(revealRoute, /export async function POST/);
  assert.match(patchRoute, /readJsonWithLimit\(request, BOARD_PATCH_BODY_MAX_BYTES\)/);
  assert.match(patchRoute, /board-password-change/);
  assert.match(verifyRoute, /clientFailureLimiter/);
  assert.match(verifyRoute, /ipFailureLimiter/);

  console.log("패드 비밀번호 비동기 해시·쿠키 회전·민감 API 보호 검증을 통과했습니다.");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
