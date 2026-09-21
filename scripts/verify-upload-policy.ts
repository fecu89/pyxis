import "../lib/load-env";
import assert from "node:assert/strict";
import sharp from "sharp";
import { SYSTEM_SETTINGS_ID } from "../lib/board/ownership-limit";
import {
  getUploadPolicy,
  guestMaxUploadBytes,
  invalidateUploadPolicyCache,
  maxUploadBytes,
} from "../lib/files/upload-policy";
import { UPLOAD_POLICY_DEFAULTS, mb } from "../lib/files/upload-policy-shape";
import { validateUploadedFile } from "../lib/files/validation";
import { getPrisma } from "../lib/prisma";

// 업로드 상한이 코드 상수·환경 변수에서 SystemSetting 행으로 옮겨졌습니다. 여기서 확인하는 것은
// "관리 화면에서 숫자를 바꾸면 서버 판정이 실제로 따라오는가" 하나입니다. tsc·lint로는
// 캐시가 옛 값을 물고 있는지, 이미지 상한이 서버에서도 걸리는지 알 수 없습니다.

type FakeUpload = { originalName: string; mimeType: string; size: number; temporaryPath: string };

async function imageFixture(bytes: number) {
  // 실제로 디코드되는 PNG여야 validateUploadedFile이 시그니처 검사를 통과합니다. 크기는
  // size 필드로 흉내 냅니다 — 상한 판정은 파일 내용이 아니라 이 값을 봅니다.
  const png = await sharp({ create: { width: 8, height: 8, channels: 4, background: { r: 1, g: 2, b: 3, alpha: 1 } } })
    .png()
    .toBuffer();
  const { writeFile } = await import("node:fs/promises");
  const { tmpdir } = await import("node:os");
  const path = await import("node:path");
  const temporaryPath = path.join(tmpdir(), `verify-upload-${bytes}-${Date.now()}.png`);
  await writeFile(temporaryPath, png);
  return { originalName: "photo.png", mimeType: "image/png", size: bytes, temporaryPath } satisfies FakeUpload;
}

async function documentFixture(bytes: number) {
  const { writeFile } = await import("node:fs/promises");
  const { tmpdir } = await import("node:os");
  const path = await import("node:path");
  const temporaryPath = path.join(tmpdir(), `verify-upload-doc-${bytes}-${Date.now()}.txt`);
  await writeFile(temporaryPath, "검증용 문서");
  return { originalName: "note.txt", mimeType: "text/plain", size: bytes, temporaryPath } satisfies FakeUpload;
}

async function disguisedImageFixture(body: string, filename = "attack.png") {
  const { writeFile } = await import("node:fs/promises");
  const { tmpdir } = await import("node:os");
  const path = await import("node:path");
  const temporaryPath = path.join(tmpdir(), `verify-upload-attack-${Date.now()}-${Math.random()}.png`);
  await writeFile(temporaryPath, body);
  return { originalName: filename, mimeType: "image/png", size: Buffer.byteLength(body), temporaryPath } satisfies FakeUpload;
}

async function main() {
  const prisma = getPrisma();
  const before = await prisma.systemSetting.findUnique({
    where: { id: SYSTEM_SETTINGS_ID },
    select: {
      maxUploadMb: true, guestMaxUploadMb: true, maxImageUploadMb: true,
      maxBoardBackgroundMb: true, maxQuizImageMb: true, maxQuizImageStorageMb: true,
    },
  });

  try {
    // ── 1. 행이 없거나 기본값이면 옮기기 전 숫자가 그대로 나와야 합니다.
    invalidateUploadPolicyCache();
    const base = await getUploadPolicy({ fresh: true });
    for (const key of Object.keys(UPLOAD_POLICY_DEFAULTS) as (keyof typeof UPLOAD_POLICY_DEFAULTS)[]) {
      assert.equal(typeof base[key], "number", `${key}가 숫자가 아닙니다.`);
    }

    // ── 2. 정책을 바꾸면 서버 판정이 따라와야 합니다.
    await prisma.systemSetting.upsert({
      where: { id: SYSTEM_SETTINGS_ID },
      create: { id: SYSTEM_SETTINGS_ID, maxUploadMb: 7, guestMaxUploadMb: 3, maxImageUploadMb: 2 },
      update: { maxUploadMb: 7, guestMaxUploadMb: 3, maxImageUploadMb: 2 },
    });
    invalidateUploadPolicyCache();

    assert.equal(await maxUploadBytes(), mb(7), "첨부 전체 상한이 정책을 따르지 않습니다.");
    assert.equal(await guestMaxUploadBytes(), mb(3), "손님 상한이 정책을 따르지 않습니다.");

    // 문서는 전체 상한(7MB)까지 통과하고 그 위는 거절돼야 합니다.
    await validateUploadedFile(await documentFixture(mb(6)));
    await assert.rejects(async () => validateUploadedFile(await documentFixture(mb(8))), "전체 상한을 넘는 파일이 통과했습니다.");

    // 이미지는 더 좁은 이미지 상한(2MB)이 걸려야 합니다. 예전에는 이 값이 클라이언트에만
    // 있어서 API를 직접 부르면 전체 상한까지 통과했습니다.
    await validateUploadedFile(await imageFixture(mb(1)));
    await assert.rejects(
      async () => validateUploadedFile(await imageFixture(mb(5))),
      "이미지 상한이 서버에서 걸리지 않습니다(전체 상한 안이라도 거절돼야 합니다).",
    );
    await assert.rejects(
      async () => validateUploadedFile(await disguisedImageFixture('<img src=x onerror="fetch(`/api/admin/users`)">')),
      "HTML을 PNG로 위장한 파일이 이미지 검증을 통과했습니다.",
    );
    await assert.rejects(
      async () => validateUploadedFile(await disguisedImageFixture('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>')),
      "스크립트 SVG를 PNG로 위장한 파일이 이미지 검증을 통과했습니다.",
    );

    // ── 3. 캐시가 옛 값을 물고 있으면 안 됩니다. 관리 API는 저장 후 캐시를 비웁니다.
    await prisma.systemSetting.update({ where: { id: SYSTEM_SETTINGS_ID }, data: { maxImageUploadMb: 6 } });
    invalidateUploadPolicyCache();
    await validateUploadedFile(await imageFixture(mb(5)));

    // ── 4. 개별 상한이 전체 상한보다 크면 읽는 쪽에서 눌러 줘야 합니다. 그러지 않으면
    //       화면은 "받아 준다"고 안내하고 서버가 거절하는 상태가 됩니다.
    await prisma.systemSetting.update({
      where: { id: SYSTEM_SETTINGS_ID },
      data: { maxUploadMb: 5, maxImageUploadMb: 50, guestMaxUploadMb: 40, maxQuizImageMb: 30, maxBoardBackgroundMb: 20 },
    });
    invalidateUploadPolicyCache();
    const clamped = await getUploadPolicy({ fresh: true });
    assert.equal(clamped.maxImageUploadMb, 5, "이미지 상한이 전체 상한으로 눌리지 않았습니다.");
    assert.equal(clamped.guestMaxUploadMb, 5, "손님 상한이 전체 상한으로 눌리지 않았습니다.");
    assert.equal(clamped.maxQuizImageMb, 5, "퀴즈 이미지 상한이 전체 상한으로 눌리지 않았습니다.");
    assert.equal(clamped.maxBoardBackgroundMb, 5, "배경 상한이 전체 상한으로 눌리지 않았습니다.");

    console.log("upload_policy_checks=passed");
  } finally {
    // 검증 전 값으로 되돌립니다. 행이 원래 없었다면 기본값으로 되돌려 둡니다.
    if (before) {
      await prisma.systemSetting.update({ where: { id: SYSTEM_SETTINGS_ID }, data: before });
    } else {
      await prisma.systemSetting.updateMany({ where: { id: SYSTEM_SETTINGS_ID }, data: UPLOAD_POLICY_DEFAULTS });
    }
    invalidateUploadPolicyCache();
    await prisma.$disconnect();
  }
}

void main().catch((error) => {
  console.error(error);
  process.exit(1);
});
