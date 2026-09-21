import { z } from "zod";
import { AuthorizationError, canAccessAdminShell, requireActiveUser, requireRole } from "@/lib/auth/authorization";
import { createAuditLogData } from "@/lib/auth/audit";
import { SYSTEM_SETTINGS_ID } from "@/lib/board/ownership-limit";
import {
  UPLOAD_POLICY_BOUNDS,
  invalidateUploadPolicyCache,
} from "@/lib/files/upload-policy";
import { apiError, assertSameOrigin } from "@/lib/http";
import { readJsonWithLimit } from "@/lib/http-json";
import { getPrisma } from "@/lib/prisma";
import {
  PLATFORM_SECURITY_POLICY_BOUNDS,
  invalidatePlatformSecurityPolicyCache,
} from "@/lib/security/platform-policy";
import { ADMIN_SETTINGS_SELECT, readAdminSettings } from "@/lib/settings/admin-settings";

// 퀴즈 한도는 "비워 두면 무제한"이 의미 있는 값이라 nullable입니다(교사 기본값). 패드 한도는
// 그런 개념이 없어 그대로 필수로 둡니다.
// 범위는 lib/files/upload-policy-shape.ts의 UPLOAD_POLICY_BOUNDS가 정본입니다. 화면 입력
// (min/max 속성)과 서버 검증이 같은 값을 봐야 "화면은 받는데 저장이 거절되는" 일이 없습니다.
function mbField(key: keyof typeof UPLOAD_POLICY_BOUNDS) {
  const bounds = UPLOAD_POLICY_BOUNDS[key];
  return z.coerce.number().int().min(bounds.min).max(bounds.max);
}

function securityPolicyField(key: keyof typeof PLATFORM_SECURITY_POLICY_BOUNDS) {
  const bounds = PLATFORM_SECURITY_POLICY_BOUNDS[key];
  return z.coerce.number().int().min(bounds.min).max(bounds.max);
}

const updateSettingsSchema = z.object({
  studentBoardLimit: z.coerce.number().int().min(1).max(1000),
  teacherBoardLimit: z.coerce.number().int().min(1).max(1000),
  studentQuizLimit: z.coerce.number().int().min(0).max(1000).nullable(),
  teacherQuizLimit: z.coerce.number().int().min(0).max(1000).nullable(),
  maxUploadMb: mbField("maxUploadMb"),
  guestMaxUploadMb: mbField("guestMaxUploadMb"),
  maxImageUploadMb: mbField("maxImageUploadMb"),
  maxBoardBackgroundMb: mbField("maxBoardBackgroundMb"),
  maxQuizImageMb: mbField("maxQuizImageMb"),
  maxQuizImageStorageMb: mbField("maxQuizImageStorageMb"),
  adminReauthWindowMinutes: securityPolicyField("adminReauthWindowMinutes"),
  publicQuizJoinPerMinute: securityPolicyField("publicQuizJoinPerMinute"),
  publicQuizApiRequestsPerMinute: securityPolicyField("publicQuizApiRequestsPerMinute"),
  publicQuizSocketEventsPerMinute: securityPolicyField("publicQuizSocketEventsPerMinute"),
  publicQuizSocketMaxConnections: securityPolicyField("publicQuizSocketMaxConnections"),
  publicQuizSocketConnectionsPerIp: securityPolicyField("publicQuizSocketConnectionsPerIp"),
  publicQuizSocketConnectionsPerParticipant: securityPolicyField("publicQuizSocketConnectionsPerParticipant"),
}).refine(
  // 개별 상한이 전체 상한보다 크면 사용자는 "받아 준다"고 안내받고 서버에서 거절당합니다.
  // 읽는 쪽에서도 다시 맞추지만, 저장 시점에 알려 주는 편이 관리자에게 훨씬 친절합니다.
  (value) => [value.guestMaxUploadMb, value.maxImageUploadMb, value.maxBoardBackgroundMb, value.maxQuizImageMb]
    .every((limit) => limit <= value.maxUploadMb),
  { message: "개별 업로드 상한은 첨부 전체 상한보다 클 수 없습니다.", path: ["maxUploadMb"] },
).refine(
  (value) => value.publicQuizSocketConnectionsPerParticipant <= value.publicQuizSocketConnectionsPerIp
    && value.publicQuizSocketConnectionsPerIp <= value.publicQuizSocketMaxConnections,
  { message: "공개 퀴즈 소켓 연결 상한은 참여자별 ≤ IP별 ≤ 전체 순서여야 합니다.", path: ["publicQuizSocketMaxConnections"] },
);
const SETTINGS_BODY_MAX_BYTES = 32 * 1024;

// 학생·교사가 소유할 수 있는 최대 패드·퀴즈 개수를 조회·수정합니다. 값을 바꿀 수 있는 건
// 전체관리자뿐이라 PATCH는 requireRole(["SUPER_ADMIN"])로 막지만, 값 자체는 사용자 역할
// 변경 화면 등에서 참고해야 해서 GET은 로그인한 관리자 전반에 열어둡니다.
export async function GET() {
  try {
    const actor = await requireActiveUser();
    if (!canAccessAdminShell(actor)) throw new AuthorizationError();
    return Response.json(await readAdminSettings(), { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) {
    return apiError(error, "설정을 불러오지 못했습니다.");
  }
}

export async function PATCH(request: Request) {
  try {
    assertSameOrigin(request);
    const actor = await requireRole(["SUPER_ADMIN"]);
    const parsed = updateSettingsSchema.safeParse(await readJsonWithLimit(request, SETTINGS_BODY_MAX_BYTES));
    if (!parsed.success) {
      const first = parsed.error.issues[0];
      return Response.json({
        error: first?.message && !first.message.startsWith("Invalid")
          ? first.message
          : "패드 한도는 1~1000, 퀴즈 한도는 0~1000, 1회 업로드 상한은 1~30MB여야 합니다.",
      }, { status: 400 });
    }

    const prisma = getPrisma();
    const updated = await prisma.$transaction(async (tx) => {
      const before = await readAdminSettings(tx);
      const next = await tx.systemSetting.upsert({
        where: { id: SYSTEM_SETTINGS_ID },
        create: { id: SYSTEM_SETTINGS_ID, ...parsed.data },
        update: parsed.data,
        select: ADMIN_SETTINGS_SELECT,
      });
      await tx.adminAuditLog.create({
        data: createAuditLogData({
          actorId: actor.id,
          action: "SYSTEM_SETTINGS_UPDATED",
          entityType: "SystemSetting",
          entityId: SYSTEM_SETTINGS_ID,
          before,
          after: next,
        }),
      });
      return next;
    });
    // 서버는 업로드 정책을 30초 캐시합니다. 저장 직후 관리자가 바로 시험해 볼 때 옛 값으로
    // 거절당하지 않도록 즉시 비웁니다.
    invalidateUploadPolicyCache();
    invalidatePlatformSecurityPolicyCache();
    return Response.json(updated);
  } catch (error) {
    return apiError(error, "설정을 저장하지 못했습니다.");
  }
}
