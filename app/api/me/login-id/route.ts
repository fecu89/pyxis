import { z } from "zod";
import { Prisma } from "@/generated/prisma/client";
import { requireActiveUser } from "@/lib/auth/authorization";
import { credentialLoginIdValueSchema } from "@/lib/auth/credentials";
import { verifyUserPassword } from "@/lib/auth/password";
import { registrationLoginIdAvailability } from "@/lib/auth/registration";
import { prepareCredentialAttempt, recordCredentialFailure, recordCredentialSuccess } from "@/lib/auth/security";
import { apiError, assertSameOrigin } from "@/lib/http";
import { readJsonWithLimit } from "@/lib/http-json";
import { getPrisma } from "@/lib/prisma";
import { trustedClientIdentifier } from "@/lib/security/client-ip";
import { createLoginIdentifierLookup, encryptUserLoginIdentifier } from "@/lib/security/pii-crypto";

const requestSchema = z.object({
  currentPassword: z.string().min(1).max(128),
  newLoginId: credentialLoginIdValueSchema,
});
const REQUEST_BODY_MAX_BYTES = 16 * 1024;

function noStoreJson(body: Record<string, unknown>, init: ResponseInit = {}) {
  const headers = new Headers(init.headers);
  headers.set("Cache-Control", "private, no-store, max-age=0");
  return Response.json(body, { ...init, headers });
}

function isLoginIdConflict(error: unknown) {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002";
}

export async function POST(request: Request) {
  try {
    assertSameOrigin(request);
    const currentUser = await requireActiveUser();
    const parsed = requestSchema.safeParse(await readJsonWithLimit(request, REQUEST_BODY_MAX_BYTES));
    if (!parsed.success) {
      return noStoreJson({ error: parsed.error.issues[0]?.message ?? "현재 비밀번호와 새 아이디를 확인해 주세요." }, { status: 400 });
    }

    const prisma = getPrisma();
    const user = await prisma.user.findUnique({
      where: { id: currentUser.id },
      select: { id: true, loginIdentifierLookup: true, passwordHash: true },
    });
    if (!user || !user.passwordHash) {
      return noStoreJson({ error: "아이디·비밀번호 로그인 계정에서만 로그인 아이디를 변경할 수 있습니다." }, { status: 409 });
    }

    // newLoginId는 credentialLoginIdValueSchema가 이미 정규화(소문자·NFKC)했으므로, 여기서 만든
    // lookup을 현재 값과 그대로 비교할 수 있습니다. 같으면 뒤에서 찾는 "이미 존재하는 행"이 항상
    // 자기 자신이 되므로, 이 검사가 없으면 무의미한 변경도 authVersion을 올려 재로그인을 강요합니다.
    const newLookup = createLoginIdentifierLookup(parsed.data.newLoginId);
    if (newLookup === user.loginIdentifierLookup) {
      return noStoreJson({ error: "현재 아이디와 다른 아이디를 입력해 주세요." }, { status: 400 });
    }

    const attempt = await prepareCredentialAttempt(trustedClientIdentifier(request.headers), user.loginIdentifierLookup);
    if (!attempt.allowed) {
      return noStoreJson(
        { error: "요청이 너무 많습니다. 잠시 후 다시 시도해 주세요." },
        { status: 429, headers: { "Retry-After": String(Math.min(attempt.retryAfterSeconds, 1_800)) } },
      );
    }
    if (!await verifyUserPassword(parsed.data.currentPassword, user.passwordHash)) {
      await recordCredentialFailure(attempt);
      return noStoreJson({ error: "현재 비밀번호가 일치하지 않습니다." }, { status: 400 });
    }

    // 위에서 이미 새 아이디가 현재 아이디와 다름을 확인했으므로, 여기서 발견되는 기존 행은
    // 항상 다른 사용자의 것입니다.
    const availability = await registrationLoginIdAvailability(parsed.data.newLoginId);
    if (!availability.available) {
      return noStoreJson({ error: "이미 사용 중이거나 가입할 수 없는 아이디입니다." }, { status: 409 });
    }

    await prisma.user.update({
      where: { id: user.id },
      data: {
        loginIdentifierLookup: availability.loginIdentifierLookup,
        loginIdentifierEncrypted: encryptUserLoginIdentifier(user.id, availability.normalized),
        authVersion: { increment: 1 },
      },
      select: { id: true },
    });
    await recordCredentialSuccess(attempt, user.loginIdentifierLookup, user.id);
    return noStoreJson({ ok: true, reauthenticate: true, newLoginId: availability.normalized });
  } catch (error) {
    if (isLoginIdConflict(error)) {
      return noStoreJson({ error: "이미 사용 중이거나 가입할 수 없는 아이디입니다." }, { status: 409 });
    }
    return apiError(error, "로그인 아이디를 변경하지 못했습니다.");
  }
}
