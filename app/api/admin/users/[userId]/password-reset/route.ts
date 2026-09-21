import { randomBytes } from "node:crypto";
import { z } from "zod";
import { AuthorizationError, canManageStudent, requireActiveUser, requireRecentAuthentication } from "@/lib/auth/authorization";
import { createAuditLogData } from "@/lib/auth/audit";
import { credentialPasswordChangeSchema } from "@/lib/auth/credentials";
import { hashUserPassword } from "@/lib/auth/password";
import { apiError, assertSameOrigin } from "@/lib/http";
import { getPrisma } from "@/lib/prisma";
import { assertCanRevokeTargetSessions } from "@/lib/users/admin-policy";
import { decryptUserLoginIdentifier } from "@/lib/users/repository";

const resetSchema = z.object({
  reason: z.string().trim().min(3).max(500),
  // 비워 두면 무작위 임시 비밀번호를 발급하고, 값을 채우면 관리자·대표교사가 지정한 값을 그대로 씁니다.
  password: z.string().min(1).max(128).optional(),
});

function temporaryPassword() {
  return `Px!${randomBytes(9).toString("base64url")}`;
}

export async function POST(request: Request, { params }: { params: Promise<{ userId: string }> }) {
  try {
    assertSameOrigin(request);
    const actor = await requireActiveUser();
    const { userId } = await params;
    if (userId === actor.id) return Response.json({ error: "내 비밀번호는 프로필에서 변경해 주세요." }, { status: 409 });
    const parsed = resetSchema.safeParse(await request.json().catch(() => null));
    if (!parsed.success) {
      const issuePath = parsed.error.issues[0]?.path[0];
      return Response.json(
        { error: issuePath === "password" ? "지정할 비밀번호 조건을 확인해 주세요." : "비밀번호 초기화 사유를 3자 이상 입력해 주세요." },
        { status: 400 },
      );
    }

    const prisma = getPrisma();
    const target = await prisma.user.findUnique({
      where: { id: userId },
      select: {
        id: true, role: true, status: true, schoolId: true, passwordHash: true,
        loginIdentifierEncrypted: true, authVersion: true, mustChangePassword: true,
      },
    });
    if (!target || target.status === "DELETED") return Response.json({ error: "사용자를 찾을 수 없습니다." }, { status: 404 });

    // 권한 판정을 계정 유형(카카오 전용 여부) 확인보다 먼저 합니다 — 그래야 대상을 관리할 권한이
    // 없는 요청자가 409 응답만으로 "이 계정이 카카오 전용인지"를 알아낼 수 없습니다. 학생 대상은
    // "이 학생을 관리할 권한이 있는가"(전체관리자, 학생 계정 발급 권한 있는 보조관리자, 같은 학교
    // 대표교사)로 판정합니다. 학생이 아닌 대상(교사·보조관리자·전체관리자)은 지금처럼 세션 해제
    // 권한 기준을 그대로 씁니다 — 대표교사가 다른 교사나 관리자를 건드릴 수는 없습니다.
    if (target.role === "STUDENT") {
      if (!canManageStudent(actor, { schoolId: target.schoolId })) {
        throw new AuthorizationError("이 학생의 비밀번호를 초기화할 권한이 없습니다.");
      }
    } else {
      assertCanRevokeTargetSessions(actor, target.role);
    }
    if (!target.passwordHash) return Response.json({ error: "카카오 전용 계정은 초기화할 비밀번호가 없습니다." }, { status: 409 });
    await requireRecentAuthentication(actor);

    let password: string;
    if (parsed.data.password) {
      // 대상의 실제 로그인 아이디를 기준으로 강도를 검증합니다(관리자 자신의 아이디가 아닙니다) —
      // 회원가입·본인 비밀번호 변경과 같은 기준(10자 이상, 영문·숫자·특수문자, 흔한 비밀번호·
      // 로그인 아이디 포함 금지)입니다.
      const targetLoginId = decryptUserLoginIdentifier(target);
      const validation = credentialPasswordChangeSchema.safeParse({
        loginId: targetLoginId,
        password: parsed.data.password,
        passwordConfirm: parsed.data.password,
      });
      if (!validation.success) {
        return Response.json(
          { error: validation.error.issues[0]?.message ?? "비밀번호 조건을 확인해 주세요." },
          { status: 400 },
        );
      }
      password = validation.data.password;
    } else {
      password = temporaryPassword();
    }
    const passwordHash = await hashUserPassword(password);
    const action = parsed.data.password ? "USER_PASSWORD_SET" : "USER_PASSWORD_RESET";
    await prisma.$transaction(async (tx) => {
      await tx.user.update({
        where: { id: userId },
        data: { passwordHash, mustChangePassword: true, authVersion: { increment: 1 } },
        select: { id: true },
      });
      await tx.adminAuditLog.create({
        data: createAuditLogData({
          actorId: actor.id,
          targetUserId: userId,
          action,
          entityType: "User",
          entityId: userId,
          before: { authVersion: target.authVersion, mustChangePassword: target.mustChangePassword },
          after: { authVersion: target.authVersion + 1, mustChangePassword: true, sessionsRevoked: true },
          reason: parsed.data.reason,
        }),
      });
    });
    // 지정값은 관리자가 이미 알고 있는 값이라 되돌려줄 필요가 없습니다 — 무작위로 발급했을 때만
    // 이 응답이 평문을 보여줄 유일한 순간입니다.
    return Response.json(
      {
        ok: true,
        authVersion: target.authVersion + 1,
        ...(parsed.data.password ? {} : { temporaryPassword: password }),
      },
      { headers: { "Cache-Control": "private, no-store, max-age=0" } },
    );
  } catch (error) {
    return apiError(error, "비밀번호를 초기화하지 못했습니다.");
  }
}
