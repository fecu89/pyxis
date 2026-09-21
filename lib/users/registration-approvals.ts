import "server-only";

import { createNotification } from "@/lib/notifications/create";
import { getPrisma } from "@/lib/prisma";
import {
  decryptOptionalUserPii,
  decryptUserLoginIdentifier,
} from "@/lib/security/pii-crypto";

export type RegistrationApprovalRecord = {
  id: string;
  name: string | null;
  loginIdentifier: string;
  loginType: "LOGIN_ID" | "KAKAO_EMAIL";
  requestedAt: string;
};

export async function getRegistrationApprovalQueue(options: { page: number; pageSize: number }) {
  const page = Math.max(1, Math.floor(options.page));
  const pageSize = Math.min(50, Math.max(10, Math.floor(options.pageSize)));
  const where = { status: "ACTIVE" as const, registrationApprovalStatus: "PENDING" as const };
  const prisma = getPrisma();
  const [totalCount, users] = await Promise.all([
    prisma.user.count({ where }),
    prisma.user.findMany({
      where,
      orderBy: [{ createdAt: "asc" }, { id: "asc" }],
      skip: (page - 1) * pageSize,
      take: pageSize,
      select: {
        id: true,
        nameEncrypted: true,
        loginIdentifierEncrypted: true,
        passwordHash: true,
        createdAt: true,
      },
    }),
  ]);

  const requests: RegistrationApprovalRecord[] = users.map((user) => ({
    id: user.id,
    name: decryptOptionalUserPii(user.id, "name", user.nameEncrypted),
    loginIdentifier: decryptUserLoginIdentifier(user.id, user.loginIdentifierEncrypted),
    loginType: user.passwordHash ? "LOGIN_ID" : "KAKAO_EMAIL",
    requestedAt: user.createdAt.toISOString(),
  }));
  return { requests, totalCount, page, pageSize };
}

export async function notifyRegistrationApprovalRequested(userId: string) {
  const admins = await getPrisma().user.findMany({
    where: { role: "SUPER_ADMIN", status: "ACTIVE" },
    select: { id: true },
  });
  await Promise.all(admins.map((admin) => createNotification({
    userId: admin.id,
    actorId: userId,
    type: "ACCOUNT_APPROVAL_REQUESTED",
  })));
}
