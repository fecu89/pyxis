import "../lib/load-env";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { getPrisma } from "@/lib/prisma";
import {
  isValidShortLinkSlug,
  normalizeShortLinkSlug,
  shortLinkSlugError,
} from "@/lib/short-links/slug";
import {
  disableShortLink,
  saveShortLink,
  ShortLinkConflictError,
} from "@/lib/short-links/service";

const ROLLBACK = new Error("ROLLBACK_SHORT_LINK_VERIFICATION");

async function main() {
  assert.equal(normalizeShortLinkSlug("  Class-3  "), "class-3");
  assert.equal(isValidShortLinkSlug("class-3"), true);
  assert.equal(isValidShortLinkSlug("ab"), false);
  assert.equal(isValidShortLinkSlug("-class"), false);
  assert.equal(isValidShortLinkSlug("class--3"), false);
  assert.match(shortLinkSlugError("한글주소") ?? "", /영문 소문자/);

  const migration = readFileSync(
    path.join(process.cwd(), "prisma/migrations/20260825020000_harden_short_links_and_board_password/migration.sql"),
    "utf8",
  );
  assert.match(migration, /ShortLink_target_check/);
  assert.match(migration, /ShortLink_active_board_key/);
  assert.match(migration, /disabledAt/);
  assert.match(migration, /ON DELETE SET NULL/);

  const prisma = getPrisma();
  const board = await prisma.board.findFirst({
    where: { deletedAt: null, ownerId: { not: null }, shortLinks: { none: { disabledAt: null } } },
    select: { id: true, ownerId: true },
  });

  if (board?.ownerId) {
    const slug = `verify-${Date.now().toString(36)}`;
    try {
      await prisma.$transaction(async (tx) => {
        const created = await tx.shortLink.create({
          data: { slug, targetType: "BOARD", boardId: board.id, createdById: board.ownerId! },
        });
        assert.equal(created.slug, slug);
        assert.equal(created.boardId, board.id);
        await tx.shortLink.update({ where: { id: created.id }, data: { disabledAt: new Date() } });
        const replacement = await tx.shortLink.create({
          data: { slug: `${slug}-new`, targetType: "BOARD", boardId: board.id, createdById: board.ownerId! },
        });
        assert.equal(replacement.boardId, board.id);
        assert.equal((await tx.shortLink.findUnique({ where: { slug } }))?.id, created.id);
        assert.ok((await tx.shortLink.findUnique({ where: { slug } }))?.disabledAt);
        assert.equal(
          (await tx.shortLink.findFirst({ where: { boardId: board.id, disabledAt: null } }))?.id,
          replacement.id,
        );
        throw ROLLBACK;
      });
    } catch (error) {
      assert.equal(error, ROLLBACK);
    }
    assert.equal(await prisma.shortLink.findUnique({ where: { slug } }), null);
    console.log("DB 생성·조회·롤백 검증을 통과했습니다.");

    const lifecycleSlugs = [
      `verify-life-${Date.now().toString(36)}`,
      `verify-next-${Date.now().toString(36)}`,
    ];
    const target = { targetType: "BOARD" as const, targetId: board.id };
    try {
      const first = await saveShortLink(target, lifecycleSlugs[0], board.ownerId);
      await disableShortLink(target);
      const second = await saveShortLink(target, lifecycleSlugs[1], board.ownerId);
      assert.notEqual(first.id, second.id);
      assert.ok((await prisma.shortLink.findUnique({ where: { slug: lifecycleSlugs[0] } }))?.disabledAt);

      const restored = await saveShortLink(target, lifecycleSlugs[0], board.ownerId);
      assert.equal(restored.id, first.id, "같은 콘텐츠는 과거 주소를 되찾아야 합니다.");
      assert.ok((await prisma.shortLink.findUnique({ where: { slug: lifecycleSlugs[1] } }))?.disabledAt);

      const otherBoard = await prisma.board.findFirst({
        where: { id: { not: board.id }, deletedAt: null, ownerId: { not: null }, shortLinks: { none: { disabledAt: null } } },
        select: { id: true, ownerId: true },
      });
      if (otherBoard?.ownerId) {
        await assert.rejects(
          saveShortLink({ targetType: "BOARD", targetId: otherBoard.id }, lifecycleSlugs[1], otherBoard.ownerId),
          ShortLinkConflictError,
        );
      }
      console.log("주소 비활성화·복구·타 콘텐츠 예약 충돌 검증을 통과했습니다.");
    } finally {
      await prisma.shortLink.deleteMany({ where: { slug: { in: lifecycleSlugs } } });
    }
  } else {
    console.log("사용 가능한 패드 fixture가 없어 DB 쓰기 검증은 건너뛰었습니다.");
  }

  console.log("짧은 주소 정규화·제약 검증을 통과했습니다.");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
}).finally(async () => {
  await getPrisma().$disconnect();
});
