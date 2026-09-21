import { getPrisma } from "@/lib/prisma";
import { publishUserEvent } from "@/lib/realtime/user-events";

const DAY_MS = 24 * 60 * 60 * 1000;
const CHECK_INTERVAL_MS = 60 * 60 * 1000;

export async function sendDueFormResponseDigests(now = new Date(), minAgeMs = DAY_MS) {
  const prisma = getPrisma();
  const cutoff = new Date(now.getTime() - minAgeMs);
  const candidates = await prisma.form.findMany({
    where: {
      deletedAt: null,
      dailyResponseDigestEnabled: true,
      responseDigestPendingCount: { gt: 0 },
      responseDigestPendingSince: { lte: cutoff },
    },
    select: { id: true },
    take: 200,
  });
  const created: Array<{ id: string; userId: string }> = [];
  for (const candidate of candidates) {
    const notification = await prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT "id" FROM "Form" WHERE "id" = ${candidate.id} FOR UPDATE`;
      const form = await tx.form.findUnique({
        where: { id: candidate.id },
        select: { id: true, ownerId: true, deletedAt: true, dailyResponseDigestEnabled: true, responseDigestPendingCount: true, responseDigestPendingSince: true },
      });
      if (!form || form.deletedAt || !form.dailyResponseDigestEnabled || form.responseDigestPendingCount <= 0 || !form.responseDigestPendingSince || form.responseDigestPendingSince > cutoff) return null;
      const row = await tx.notification.create({
        data: { userId: form.ownerId, type: "FORM_RESPONSE_DIGEST", formId: form.id, responseCount: form.responseDigestPendingCount },
        select: { id: true, userId: true },
      });
      // 알림 장부는 편집 문서가 아닙니다. Prisma update로 updatedAt까지 바꾸면 열린 편집기가
      // 내용 변경 없이 충돌하므로 raw SQL로 장부 열만 갱신합니다.
      await tx.$executeRaw`
        UPDATE "Form"
        SET "responseDigestPendingCount" = 0,
            "responseDigestPendingSince" = NULL,
            "responseDigestLastSentAt" = ${now}
        WHERE "id" = ${form.id}
      `;
      return row;
    });
    if (notification) created.push(notification);
  }
  for (const notification of created) {
    publishUserEvent(notification.userId, { type: "notification.created", notificationId: notification.id });
  }
  return created.length;
}

let started = false;
export function startFormResponseDigestScheduler() {
  if (started) return;
  started = true;
  const schedule = (delay: number) => {
    const timer = setTimeout(async () => {
      try {
        await sendDueFormResponseDigests();
      } catch (error) {
        console.error("form response digest failed", error);
      } finally {
        schedule(CHECK_INTERVAL_MS);
      }
    }, delay);
    timer.unref();
  };
  schedule(5 * 60_000);
}
