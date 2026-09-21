import "server-only";

import type { Prisma } from "@/generated/prisma/client";
import { SYSTEM_SETTINGS_ID } from "@/lib/board/ownership-limit";
import { UPLOAD_POLICY_DEFAULTS, type UploadPolicy } from "@/lib/files/upload-policy-shape";
import { getPrisma } from "@/lib/prisma";
import { PLATFORM_SECURITY_POLICY_DEFAULTS, type PlatformSecurityPolicy } from "@/lib/security/platform-policy-shape";

export type AdminSettings = UploadPolicy & PlatformSecurityPolicy & {
  studentBoardLimit: number;
  teacherBoardLimit: number;
  studentQuizLimit: number | null;
  teacherQuizLimit: number | null;
};

export const ADMIN_SETTINGS_SELECT = {
  studentBoardLimit: true,
  teacherBoardLimit: true,
  studentQuizLimit: true,
  teacherQuizLimit: true,
  maxUploadMb: true,
  guestMaxUploadMb: true,
  maxImageUploadMb: true,
  maxBoardBackgroundMb: true,
  maxQuizImageMb: true,
  maxQuizImageStorageMb: true,
  adminReauthWindowMinutes: true,
  publicQuizJoinPerMinute: true,
  publicQuizApiRequestsPerMinute: true,
  publicQuizSocketEventsPerMinute: true,
  publicQuizSocketMaxConnections: true,
  publicQuizSocketConnectionsPerIp: true,
  publicQuizSocketConnectionsPerParticipant: true,
} as const;

export const ADMIN_SETTINGS_DEFAULTS: AdminSettings = {
  studentBoardLimit: 10,
  teacherBoardLimit: 40,
  studentQuizLimit: 10,
  teacherQuizLimit: null,
  ...UPLOAD_POLICY_DEFAULTS,
  ...PLATFORM_SECURITY_POLICY_DEFAULTS,
};

type AdminSettingsClient = Pick<Prisma.TransactionClient, "systemSetting">;

export async function readAdminSettings(client: AdminSettingsClient = getPrisma()): Promise<AdminSettings> {
  const row = await client.systemSetting.findUnique({ where: { id: SYSTEM_SETTINGS_ID }, select: ADMIN_SETTINGS_SELECT });
  return { ...ADMIN_SETTINGS_DEFAULTS, ...(row ?? {}) };
}
