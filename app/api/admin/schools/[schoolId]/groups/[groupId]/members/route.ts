import { z } from "zod";
import { requireActiveUser } from "@/lib/auth/authorization";
import { apiError } from "@/lib/http";
import { getPrisma } from "@/lib/prisma";
import { decryptOptionalUserPii, decryptUserLoginIdentifier } from "@/lib/security/pii-crypto";
import { assertCanViewSchoolMembers } from "@/lib/users/admin-policy";

const querySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(50).default(20),
});

export async function GET(
  request: Request,
  { params }: { params: Promise<{ schoolId: string; groupId: string }> },
) {
  try {
    const actor = await requireActiveUser();
    const { schoolId, groupId } = await params;
    assertCanViewSchoolMembers(actor, schoolId);
    const parsed = querySchema.safeParse(Object.fromEntries(new URL(request.url).searchParams));
    if (!parsed.success) return Response.json({ error: "페이지 정보를 확인해 주세요." }, { status: 400 });

    const prisma = getPrisma();
    const group = await prisma.schoolGroup.findFirst({
      where: { id: groupId, schoolId },
      select: { id: true, name: true, type: true },
    });
    if (!group) return Response.json({ error: "반·부서를 찾을 수 없습니다." }, { status: 404 });

    const where = { schoolId, schoolGroupId: groupId, status: { not: "DELETED" as const } };
    const { page, pageSize } = parsed.data;
    const [totalCount, users] = await Promise.all([
      prisma.user.count({ where }),
      prisma.user.findMany({
        where,
        orderBy: group.type === "CLASS"
          ? [{ studentNumber: { sort: "asc", nulls: "last" } }, { createdAt: "asc" }, { id: "asc" }]
          : [{ createdAt: "asc" }, { id: "asc" }],
        skip: (page - 1) * pageSize,
        take: pageSize,
        select: {
          id: true,
          nameEncrypted: true,
          loginIdentifierEncrypted: true,
          role: true,
          status: true,
          studentNumber: true,
        },
      }),
    ]);

    return Response.json({
      group,
      members: users.map((user) => ({
        id: user.id,
        name: decryptOptionalUserPii(user.id, "name", user.nameEncrypted),
        loginIdentifier: user.loginIdentifierEncrypted ? decryptUserLoginIdentifier(user.id, user.loginIdentifierEncrypted) : "로그인 정보 없음",
        role: user.role,
        status: user.status,
        studentNumber: user.studentNumber,
      })),
      page,
      pageSize,
      totalCount,
      hasMore: page * pageSize < totalCount,
    }, { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) {
    return apiError(error, "소속 구성원을 불러오지 못했습니다.");
  }
}
