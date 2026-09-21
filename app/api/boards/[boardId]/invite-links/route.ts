import { z } from "zod";
import { canManageBoardSettings, getEffectiveBoardAccess, requireActiveUser } from "@/lib/auth/authorization";
import { generateInviteToken, hashInviteToken } from "@/lib/board/invite-links";
import { apiError, assertSameOrigin } from "@/lib/http";
import { getPrisma } from "@/lib/prisma";

// 초대 링크는 유출 시 남용될 수 있어 OWNER/ADMIN을 부여할 수 없게 하고, 학생 역할 제한과 같은 선상에서 MEMBER·VIEWER만 허용합니다.
const createInviteLinkSchema = z.object({
  role: z.enum(["MEMBER", "VIEWER"]).default("MEMBER"),
  expiresInDays: z.number().int().min(1).max(365).optional(),
  maxUses: z.number().int().min(1).max(1000).optional(),
});
const INVITE_LINK_PAGE_SIZE = 50;

export async function GET(request: Request, { params }: { params: Promise<{ boardId: string }> }) {
  try {
    const current = await requireActiveUser();
    const { boardId } = await params;
    const access = await getEffectiveBoardAccess(boardId, current);
    if (!access || !canManageBoardSettings(current, access)) {
      return Response.json({ error: "초대 링크를 관리할 권한이 없습니다." }, { status: 403 });
    }
    const page = Math.max(1, Math.min(10_000, Number.parseInt(new URL(request.url).searchParams.get("page") ?? "1", 10) || 1));
    const prisma = getPrisma();
    const [links, totalCount] = await Promise.all([
      prisma.boardInviteLink.findMany({
        where: { boardId },
        orderBy: { createdAt: "desc" },
        skip: (page - 1) * INVITE_LINK_PAGE_SIZE,
        take: INVITE_LINK_PAGE_SIZE,
        select: { id: true, role: true, expiresAt: true, maxUses: true, useCount: true, revokedAt: true, createdAt: true },
      }),
      prisma.boardInviteLink.count({ where: { boardId } }),
    ]);
    return Response.json({ inviteLinks: links, page, pageSize: INVITE_LINK_PAGE_SIZE, totalCount });
  } catch (error) {
    return apiError(error, "초대 링크를 불러오지 못했습니다.");
  }
}

export async function POST(request: Request, { params }: { params: Promise<{ boardId: string }> }) {
  try {
    assertSameOrigin(request);
    const current = await requireActiveUser();
    const { boardId } = await params;
    const access = await getEffectiveBoardAccess(boardId, current);
    if (!access || !canManageBoardSettings(current, access)) {
      return Response.json({ error: "초대 링크를 만들 권한이 없습니다." }, { status: 403 });
    }
    const parsed = createInviteLinkSchema.safeParse(await request.json().catch(() => ({})));
    if (!parsed.success) return Response.json({ error: "초대 링크 옵션을 확인해 주세요." }, { status: 400 });

    const token = generateInviteToken();
    const inviteLink = await getPrisma().boardInviteLink.create({
      data: {
        boardId,
        tokenHash: hashInviteToken(token),
        role: parsed.data.role,
        createdById: current.id,
        expiresAt: parsed.data.expiresInDays ? new Date(Date.now() + parsed.data.expiresInDays * 24 * 60 * 60 * 1000) : null,
        maxUses: parsed.data.maxUses ?? null,
      },
      select: { id: true, role: true, expiresAt: true, maxUses: true, useCount: true, revokedAt: true, createdAt: true },
    });
    return Response.json({ inviteLink, token }, { status: 201 });
  } catch (error) {
    return apiError(error, "초대 링크를 만들지 못했습니다.");
  }
}
