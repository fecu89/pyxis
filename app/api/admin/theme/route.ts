import { z } from "zod";
import { AuthorizationError, canAccessAdminShell, requireActiveUser, requireRole } from "@/lib/auth/authorization";
import { createAuditLogData } from "@/lib/auth/audit";
import { SYSTEM_SETTINGS_ID } from "@/lib/board/ownership-limit";
import { apiError, assertSameOrigin } from "@/lib/http";
import { getPrisma } from "@/lib/prisma";
import { BRAND_CHROMA_MAX, BRAND_CHROMA_MIN, DEFAULT_BRAND_THEME, normalizeBrandTheme } from "@/lib/theme";

// 색상각은 원형이라 359 다음이 0입니다. 359를 상한으로 두고 normalize가 감아 줍니다.
const updateThemeSchema = z.object({
  brandHue: z.coerce.number().int().min(0).max(359),
  brandChroma: z.coerce.number().int().min(BRAND_CHROMA_MIN).max(BRAND_CHROMA_MAX),
});

const THEME_SELECT = { brandHue: true, brandChroma: true } as const;

async function readTheme(client = getPrisma()) {
  const row = await client.systemSetting.findUnique({ where: { id: SYSTEM_SETTINGS_ID }, select: THEME_SELECT });
  return row ? normalizeBrandTheme(row) : DEFAULT_BRAND_THEME;
}

// 사이트 전체 브랜드 색입니다. 값 자체는 관리 콘솔 어느 탭에서든 미리보기에 쓸 수 있어
// GET은 관리 화면 접근 권한 전반에 열고, 바꾸는 건 전체관리자만 할 수 있습니다.
export async function GET() {
  try {
    const actor = await requireActiveUser();
    if (!canAccessAdminShell(actor)) throw new AuthorizationError();
    return Response.json(await readTheme(), { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) {
    return apiError(error, "테마를 불러오지 못했습니다.");
  }
}

export async function PATCH(request: Request) {
  try {
    assertSameOrigin(request);
    const actor = await requireRole(["SUPER_ADMIN"]);
    const parsed = updateThemeSchema.safeParse(await request.json());
    if (!parsed.success) {
      return Response.json(
        { error: `색상각은 0~359, 채도는 ${BRAND_CHROMA_MIN}~${BRAND_CHROMA_MAX} 사이의 정수여야 합니다.` },
        { status: 400 },
      );
    }

    const prisma = getPrisma();
    const before = await readTheme(prisma);
    // 저장 값도 normalize를 거칩니다. 스키마가 이미 범위를 보지만, DB에 들어가는 값과
    // 화면이 읽는 값이 같은 함수를 통과해야 둘이 어긋날 일이 없습니다.
    const next = normalizeBrandTheme(parsed.data);
    const updated = await prisma.systemSetting.upsert({
      where: { id: SYSTEM_SETTINGS_ID },
      create: { id: SYSTEM_SETTINGS_ID, ...next },
      update: next,
      select: THEME_SELECT,
    });
    await prisma.adminAuditLog.create({
      data: createAuditLogData({
        actorId: actor.id,
        action: "SYSTEM_SETTINGS_UPDATED",
        entityType: "SystemSetting",
        entityId: SYSTEM_SETTINGS_ID,
        before,
        after: updated,
      }),
    });
    return Response.json(updated);
  } catch (error) {
    return apiError(error, "테마를 저장하지 못했습니다.");
  }
}
