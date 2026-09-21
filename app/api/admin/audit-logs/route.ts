import { z } from "zod";
import { requireSystemPermission } from "@/lib/auth/authorization";
import { apiError } from "@/lib/http";
import { getAuditLogPage } from "@/lib/auth/audit";

const actions = [
  "USER_ROLE_CHANGED", "USER_STATUS_CHANGED", "USER_SESSIONS_REVOKED",
  "ADMIN_PERMISSION_GRANTED", "ADMIN_PERMISSION_REVOKED", "USER_PII_VIEWED",
  "GLOBAL_POST_CREATED", "GLOBAL_POST_UPDATED", "GLOBAL_POST_HIDDEN", "GLOBAL_POST_RESTORED",
  "GLOBAL_BOARD_UPDATED", "BOARD_OWNERSHIP_TRANSFERRED", "BOARD_PASSWORD_VIEWED", "GLOBAL_BOARD_ARCHIVED",
  "GLOBAL_BOARD_RESTORED", "GLOBAL_ENTITY_PURGED",
] as const;

const querySchema = z.object({
  cursor: z.string().min(1).optional(),
  limit: z.coerce.number().int().min(1).max(50).default(25),
  action: z.enum(actions).optional(),
  targetUserId: z.string().min(1).optional(),
});

export async function GET(request: Request) {
  try {
    await requireSystemPermission("VIEW_AUDIT_LOG");
    const parsed = querySchema.safeParse(Object.fromEntries(new URL(request.url).searchParams));
    if (!parsed.success) return Response.json({ error: "감사 로그 검색 조건을 확인해 주세요." }, { status: 400 });
    const { cursor, limit, action, targetUserId } = parsed.data;
    return Response.json(await getAuditLogPage({ cursor, limit, action, targetUserId }), { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) {
    return apiError(error, "감사 로그를 불러오지 못했습니다.");
  }
}
