import "../lib/load-env";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { encode } from "next-auth/jwt";
import { createPadActivity } from "./fixtures";
import { getPrisma } from "../lib/prisma";

const baseUrl = process.env.VERIFY_BASE_URL || "http://localhost:3001";

async function main() {
  const secret = process.env.AUTH_SECRET;
  if (!secret) throw new Error("AUTH_SECRET 환경 변수가 필요합니다.");
  const prisma = getPrisma();
  const owner = await prisma.user.findFirst({
    where: { status: "ACTIVE" },
    select: { id: true, authVersion: true },
  });
  if (!owner) throw new Error("검증에 사용할 활성 사용자가 없습니다.");

  const title = `내보내기 제한 검증 ${randomUUID().slice(0, 8)}`;
  const activityId = await createPadActivity(prisma, owner.id, title);
  const board = await prisma.board.create({
    data: { ownerId: owner.id, activityId, slug: `verify-export-${randomUUID()}`, title },
    select: { id: true },
  });

  try {
    const token = await encode({
      secret,
      maxAge: 300,
      token: {
        userId: owner.id,
        authVersion: owner.authVersion,
        sessionInvalid: false,
        onboardingCompleted: true,
        onboardingState: "COMPLETE",
      },
    });
    const headers = { Cookie: `next-auth.session-token=${token}; __Secure-next-auth.session-token=${token}` };

    for (let attempt = 1; attempt <= 6; attempt += 1) {
      const response = await fetch(`${baseUrl}/api/boards/${board.id}/exports/xlsx`, { headers });
      assert.equal(response.status, attempt <= 5 ? 200 : 429, `XLSX ${attempt}번째 요청 상태가 올바르지 않습니다.`);
      await response.arrayBuffer();
    }
    for (let attempt = 1; attempt <= 4; attempt += 1) {
      const response = await fetch(`${baseUrl}/api/boards/${board.id}/exports/attachments-zip`, { headers });
      assert.equal(response.status, attempt <= 3 ? 200 : 429, `ZIP ${attempt}번째 요청 상태가 올바르지 않습니다.`);
      await response.arrayBuffer();
    }
    console.log("export_rate_limit_checks=passed");
  } finally {
    await prisma.activity.delete({ where: { id: activityId } }).catch(() => undefined);
    await prisma.$disconnect();
  }
}

void main().catch((error) => {
  console.error(error);
  process.exit(1);
});
