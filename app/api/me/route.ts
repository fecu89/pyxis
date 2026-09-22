import { randomUUID } from "node:crypto";
import { unlink } from "node:fs/promises";
import { requireActiveUser } from "@/lib/auth/authorization";
import { succeedOwnedBoards, summarizeSuccessions } from "@/lib/board/succession";
import { getAvatarPath } from "@/lib/files/paths";
import { apiError, assertSameOrigin } from "@/lib/http";
import { readJsonWithLimit } from "@/lib/http-json";
import { getPrisma } from "@/lib/prisma";
import { encryptUserLoginIdentifier, encryptUserPii } from "@/lib/security/pii-crypto";
import { isNicknameAvailable, isNicknameUniqueConflict, nicknameSchema } from "@/lib/users/nickname";
import { z } from "zod";

const updateProfileSchema = z.object({ name: nicknameSchema });
const UPDATE_PROFILE_BODY_MAX_BYTES = 16 * 1024;

export async function PATCH(request: Request) {
  try {
    assertSameOrigin(request);
    const user = await requireActiveUser();
    const parsed = updateProfileSchema.safeParse(await readJsonWithLimit(request, UPDATE_PROFILE_BODY_MAX_BYTES));
    if (!parsed.success) return Response.json({ error: parsed.error.issues[0]?.message ?? "닉네임을 확인해 주세요." }, { status: 400 });
    const nickname = await isNicknameAvailable(parsed.data.name, { schoolId: user.school?.id ?? null, excludeUserId: user.id });
    if (!nickname.available) return Response.json({ error: "같은 학교에서 이미 사용 중인 닉네임입니다." }, { status: 409 });
    await getPrisma().user.update({
      where: { id: user.id },
      data: {
        nameEncrypted: encryptUserPii(user.id, "name", parsed.data.name),
        nameLookup: nickname.nameLookup,
      },
    });
    return Response.json({ ok: true, name: parsed.data.name });
  } catch (error) {
    if (isNicknameUniqueConflict(error)) {
      return Response.json({ error: "같은 학교에서 이미 사용 중인 닉네임입니다." }, { status: 409 });
    }
    return apiError(error, "프로필을 저장하지 못했습니다.");
  }
}

// 소유한 패드가 있어도 탈퇴할 수 있습니다. 예전에는 409로 막고 "먼저 소유권을 넘기라"고 안내했는데,
// 소유권 이전은 TRANSFER_BOARD_OWNERSHIP 권한이 필요해서 일반 교사·학생은 자기 패드조차 넘길 수
// 없었습니다 — 즉 스스로 탈퇴할 방법이 아예 없었습니다. 이제 탈퇴 시점에 소유권을 승계시킵니다.
export async function DELETE(request: Request) {
  try {
    assertSameOrigin(request);
    const user = await requireActiveUser();
    const prisma = getPrisma();

    const successions = await prisma.$transaction(async (tx) => {
      const profile = await tx.user.findUnique({ where: { id: user.id }, select: { schoolId: true } });
      const result = await succeedOwnedBoards(tx, user.id, profile?.schoolId ?? null);
      const deletedKey = randomUUID();
      await tx.user.update({
        where: { id: user.id },
        data: {
          status: "DELETED",
          authVersion: { increment: 1 },
          nameEncrypted: encryptUserPii(user.id, "name", "탈퇴한 사용자"),
          nameLookup: null,
          imageEncrypted: null,
          passwordHash: null,
          // 탈퇴 후 같은 loginId 또는 카카오 이메일로 다시 가입할 수 있도록 조회 키를 무효화합니다.
          loginIdentifierLookup: `deleted:${deletedKey}`,
          loginIdentifierEncrypted: encryptUserLoginIdentifier(user.id, `deleted-${deletedKey}`),
        },
      });
      return result;
    }, { isolationLevel: "Serializable" });
    await unlink(getAvatarPath(user.id)).catch(() => undefined);

    return Response.json({ ok: true, boardSuccession: summarizeSuccessions(successions) });
  } catch (error) {
    return apiError(error, "회원 탈퇴를 처리하지 못했습니다.");
  }
}
