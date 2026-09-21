import "server-only";

import { Prisma, type ShortLink } from "@/generated/prisma/client";
import { AuthorizationError } from "@/lib/auth/authorization";
import { getPrisma } from "@/lib/prisma";
import { invalidateShortLinkSlug } from "@/lib/short-links/cache";
import type { ShortLinkTarget } from "@/lib/short-links/access";

export const SHORT_LINK_SELECT = {
  id: true,
  slug: true,
  targetType: true,
  createdAt: true,
  updatedAt: true,
} as const;

export class ShortLinkConflictError extends Error {
  constructor() {
    super("이미 사용 중이거나 예약된 짧은 주소입니다.");
    this.name = "ShortLinkConflictError";
  }
}

export function activeTargetWhere(target: ShortLinkTarget): Prisma.ShortLinkWhereInput {
  const base = { targetType: target.targetType, disabledAt: null };
  if (target.targetType === "BOARD") return { ...base, boardId: target.targetId };
  if (target.targetType === "QUIZ_SESSION") return { ...base, quizSessionId: target.targetId };
  return { ...base, formId: target.targetId };
}

function targetCreateData(target: ShortLinkTarget, slug: string, createdById: string): Prisma.ShortLinkUncheckedCreateInput {
  const base = { slug, targetType: target.targetType, createdById };
  if (target.targetType === "BOARD") return { ...base, boardId: target.targetId };
  if (target.targetType === "QUIZ_SESSION") return { ...base, quizSessionId: target.targetId };
  return { ...base, formId: target.targetId };
}

function matchesTarget(
  link: Pick<ShortLink, "targetType" | "boardId" | "quizSessionId" | "formId">,
  target: ShortLinkTarget,
) {
  if (link.targetType !== target.targetType) return false;
  if (target.targetType === "BOARD") return link.boardId === target.targetId;
  if (target.targetType === "QUIZ_SESSION") return link.quizSessionId === target.targetId;
  return link.formId === target.targetId;
}

async function lockAndAssertActiveTarget(tx: Prisma.TransactionClient, target: ShortLinkTarget) {
  if (target.targetType === "BOARD") {
    const rows = await tx.$queryRaw<Array<{ id: string; deletedAt: Date | null }>>(Prisma.sql`
      SELECT "id", "deletedAt" FROM "Board" WHERE "id" = ${target.targetId} FOR UPDATE
    `);
    if (!rows[0] || rows[0].deletedAt) throw new AuthorizationError("활성 패드에만 짧은 주소를 설정할 수 있습니다.");
    return;
  }
  if (target.targetType === "FORM") {
    const rows = await tx.$queryRaw<Array<{ id: string; deletedAt: Date | null }>>(Prisma.sql`
      SELECT "id", "deletedAt" FROM "Form" WHERE "id" = ${target.targetId} FOR UPDATE
    `);
    if (!rows[0] || rows[0].deletedAt) throw new AuthorizationError("활성 설문에만 짧은 주소를 설정할 수 있습니다.");
    return;
  }

  const rows = await tx.$queryRaw<Array<{ id: string; status: string; quizDeletedAt: Date | null }>>(Prisma.sql`
    SELECT session."id", session."status", quiz."deletedAt" AS "quizDeletedAt"
    FROM "QuizSession" AS session
    JOIN "Quiz" AS quiz ON quiz."id" = session."quizId"
    WHERE session."id" = ${target.targetId}
    FOR UPDATE OF session
  `);
  const session = rows[0];
  if (!session || session.quizDeletedAt || session.status === "FINISHED" || session.status === "CANCELLED") {
    throw new AuthorizationError("진행 중인 퀴즈 세션에만 짧은 주소를 설정할 수 있습니다.");
  }
}

export async function findActiveShortLink(target: ShortLinkTarget) {
  return getPrisma().shortLink.findFirst({ where: activeTargetWhere(target), select: SHORT_LINK_SELECT });
}

export async function saveShortLink(target: ShortLinkTarget, slug: string, createdById: string) {
  const invalidated = new Set<string>();
  const shortLink = await getPrisma().$transaction(async (tx) => {
    await lockAndAssertActiveTarget(tx, target);
    const active = await tx.shortLink.findFirst({ where: activeTargetWhere(target) });
    const reserved = await tx.shortLink.findUnique({ where: { slug } });

    // 전역 unique 제약에만 맡기지 않고 예약 행까지 먼저 검사해 사용자에게 안정적인 충돌 응답을 줍니다.
    if (reserved && !matchesTarget(reserved, target)) throw new ShortLinkConflictError();
    if (reserved && reserved.id === active?.id) {
      return tx.shortLink.findUniqueOrThrow({ where: { id: reserved.id }, select: SHORT_LINK_SELECT });
    }

    const disabledAt = new Date();
    if (active) {
      await tx.shortLink.update({ where: { id: active.id }, data: { disabledAt } });
      invalidated.add(active.slug);
    }

    if (reserved) {
      const restored = await tx.shortLink.update({
        where: { id: reserved.id },
        data: { disabledAt: null, createdById },
        select: SHORT_LINK_SELECT,
      });
      invalidated.add(restored.slug);
      return restored;
    }

    const created = await tx.shortLink.create({
      data: targetCreateData(target, slug, createdById),
      select: SHORT_LINK_SELECT,
    });
    invalidated.add(created.slug);
    return created;
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });

  for (const value of invalidated) invalidateShortLinkSlug(value);
  return shortLink;
}

export async function disableShortLink(target: ShortLinkTarget) {
  const disabled = await getPrisma().$transaction(async (tx) => {
    await lockAndAssertActiveTarget(tx, target);
    const active = await tx.shortLink.findFirst({ where: activeTargetWhere(target), select: { id: true, slug: true } });
    if (!active) return null;
    await tx.shortLink.update({ where: { id: active.id }, data: { disabledAt: new Date() } });
    return active;
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
  if (disabled) invalidateShortLinkSlug(disabled.slug);
  return disabled;
}

export async function disableQuizSessionShortLinks(tx: Prisma.TransactionClient, sessionId: string, disabledAt = new Date()) {
  const links = await tx.shortLink.findMany({
    where: { quizSessionId: sessionId, disabledAt: null },
    select: { slug: true },
  });
  if (links.length) {
    await tx.shortLink.updateMany({
      where: { quizSessionId: sessionId, disabledAt: null },
      data: { disabledAt },
    });
  }
  return links.map((link) => link.slug);
}

export function invalidateShortLinkSlugs(slugs: string[]) {
  for (const slug of slugs) invalidateShortLinkSlug(slug);
}
