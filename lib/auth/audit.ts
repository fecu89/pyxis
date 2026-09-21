import "server-only";

import type { AdminAuditAction, Prisma } from "@/generated/prisma/client";
import { getPrisma } from "@/lib/prisma";
import { toPublicAuthorDTO } from "@/lib/users/repository";

type AuditInput = {
  actorId: string;
  targetUserId?: string | null;
  action: AdminAuditAction;
  entityType?: string | null;
  entityId?: string | null;
  before?: Prisma.InputJsonValue;
  after?: Prisma.InputJsonValue;
  reason?: string | null;
};

export function createAuditLogData(input: AuditInput): Prisma.AdminAuditLogUncheckedCreateInput {
  return {
    actorId: input.actorId,
    targetUserId: input.targetUserId ?? null,
    action: input.action,
    entityType: input.entityType ?? null,
    entityId: input.entityId ?? null,
    before: input.before,
    after: input.after,
    reason: input.reason?.trim().slice(0, 500) || null,
  };
}

export async function getAuditLogPage(filters: {
  cursor?: string;
  limit: number;
  action?: AdminAuditAction;
  targetUserId?: string;
}) {
  const logs = await getPrisma().adminAuditLog.findMany({
    where: {
      ...(filters.action ? { action: filters.action } : {}),
      ...(filters.targetUserId ? { targetUserId: filters.targetUserId } : {}),
    },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    take: filters.limit + 1,
    ...(filters.cursor ? { cursor: { id: filters.cursor }, skip: 1 } : {}),
    select: {
      id: true,
      action: true,
      entityType: true,
      entityId: true,
      before: true,
      after: true,
      reason: true,
      createdAt: true,
      actor: { select: { id: true, nameEncrypted: true, imageEncrypted: true } },
      targetUser: { select: { id: true, nameEncrypted: true, imageEncrypted: true } },
    },
  });
  const hasMore = logs.length > filters.limit;
  const page = hasMore ? logs.slice(0, filters.limit) : logs;
  return {
    logs: page.map((log) => ({
      ...log,
      actor: toPublicAuthorDTO(log.actor),
      targetUser: log.targetUser ? toPublicAuthorDTO(log.targetUser) : null,
      createdAt: log.createdAt.toISOString(),
    })),
    nextCursor: hasMore ? page.at(-1)?.id ?? null : null,
  };
}
