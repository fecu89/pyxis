import { z } from "zod";
import { requireActiveUser } from "@/lib/auth/authorization";
import { credentialPasswordChangeSchema } from "@/lib/auth/credentials";
import { hashUserPassword, verifyUserPassword } from "@/lib/auth/password";
import { prepareCredentialAttempt, recordCredentialFailure, recordCredentialSuccess } from "@/lib/auth/security";
import { apiError, assertSameOrigin } from "@/lib/http";
import { readJsonWithLimit } from "@/lib/http-json";
import { getPrisma } from "@/lib/prisma";
import { trustedClientIdentifier } from "@/lib/security/client-ip";
import { decryptUserLoginIdentifier } from "@/lib/users/repository";

const requestSchema = z.object({
  currentPassword: z.string().min(1).max(128),
  newPassword: z.string().min(1).max(128),
  newPasswordConfirm: z.string().min(1).max(128),
});
const REQUEST_BODY_MAX_BYTES = 16 * 1024;

function noStoreJson(body: Record<string, unknown>, init: ResponseInit = {}) {
  const headers = new Headers(init.headers);
  headers.set("Cache-Control", "private, no-store, max-age=0");
  return Response.json(body, { ...init, headers });
}

export async function POST(request: Request) {
  try {
    assertSameOrigin(request);
    const currentUser = await requireActiveUser();
    const parsed = requestSchema.safeParse(await readJsonWithLimit(request, REQUEST_BODY_MAX_BYTES));
    if (!parsed.success) return noStoreJson({ error: "현재 비밀번호와 새 비밀번호를 확인해 주세요." }, { status: 400 });
    if (parsed.data.currentPassword === parsed.data.newPassword) {
      return noStoreJson({ error: "현재 비밀번호와 다른 새 비밀번호를 입력해 주세요." }, { status: 400 });
    }

    const prisma = getPrisma();
    const user = await prisma.user.findUnique({
      where: { id: currentUser.id },
      select: { id: true, loginIdentifierLookup: true, loginIdentifierEncrypted: true, passwordHash: true },
    });
    if (!user || !user.passwordHash) {
      return noStoreJson({ error: "아이디·비밀번호 로그인 계정에서만 비밀번호를 변경할 수 있습니다." }, { status: 409 });
    }
    const loginId = decryptUserLoginIdentifier(user);
    const passwordValidation = credentialPasswordChangeSchema.safeParse({
      loginId,
      password: parsed.data.newPassword,
      passwordConfirm: parsed.data.newPasswordConfirm,
    });
    if (!passwordValidation.success) {
      return noStoreJson({ error: passwordValidation.error.issues[0]?.message ?? "새 비밀번호를 확인해 주세요." }, { status: 400 });
    }

    const attempt = await prepareCredentialAttempt(trustedClientIdentifier(request.headers), user.loginIdentifierLookup);
    if (!attempt.allowed) {
      return noStoreJson(
        { error: "비밀번호 확인 시도가 너무 많습니다. 잠시 후 다시 시도해 주세요." },
        { status: 429, headers: { "Retry-After": String(Math.min(attempt.retryAfterSeconds, 1_800)) } },
      );
    }
    if (!await verifyUserPassword(parsed.data.currentPassword, user.passwordHash)) {
      await recordCredentialFailure(attempt);
      return noStoreJson({ error: "현재 비밀번호가 일치하지 않습니다." }, { status: 400 });
    }

    const passwordHash = await hashUserPassword(passwordValidation.data.password);
    await prisma.user.update({
      where: { id: user.id },
      data: { passwordHash, mustChangePassword: false, authVersion: { increment: 1 } },
      select: { id: true },
    });
    await recordCredentialSuccess(attempt, user.loginIdentifierLookup, user.id);
    return noStoreJson({ ok: true, reauthenticate: true });
  } catch (error) {
    return apiError(error, "비밀번호를 변경하지 못했습니다.");
  }
}
