import { randomUUID } from "node:crypto";
import { Prisma } from "@/generated/prisma/client";
import { credentialRegisterSchema } from "@/lib/auth/credentials";
import { signupConsentData } from "@/lib/auth/signup-consent";
import { hashUserPassword } from "@/lib/auth/password";
import { registrationLoginIdAvailability } from "@/lib/auth/registration";
import { prepareRegistrationAttempt, recordRegistrationResult } from "@/lib/auth/security";
import { apiError, assertSameOrigin } from "@/lib/http";
import { readJsonWithLimit } from "@/lib/http-json";
import { getPrisma } from "@/lib/prisma";
import { trustedClientIdentifier } from "@/lib/security/client-ip";
import { createLoginIdentifierLookup, encryptUserLoginIdentifier } from "@/lib/security/pii-crypto";
import { notifyRegistrationApprovalRequested } from "@/lib/users/registration-approvals";

const REGISTER_BODY_MAX_BYTES = 64 * 1024;

function noStoreJson(body: Record<string, unknown>, init: ResponseInit = {}) {
  const headers = new Headers(init.headers);
  headers.set("Cache-Control", "no-store, max-age=0");
  return Response.json(body, { ...init, headers });
}

function isLoginIdConflict(error: unknown) {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002";
}

export async function POST(request: Request) {
  try {
    assertSameOrigin(request);
    const parsed = credentialRegisterSchema.safeParse(await readJsonWithLimit(request, REGISTER_BODY_MAX_BYTES));
    if (!parsed.success) {
      return noStoreJson(
        { error: parsed.error.issues[0]?.message || "가입 정보를 확인해 주세요." },
        { status: 400 },
      );
    }

    // 제한을 먼저 확인해 이미 차단된 요청이 사용자 존재 여부 조회와 비밀번호 해싱으로
    // 넘어가지 않게 합니다. loginId는 스키마에서 정규화된 값입니다.
    const loginIdentifierLookup = createLoginIdentifierLookup(parsed.data.loginId);
    const attempt = await prepareRegistrationAttempt(
      trustedClientIdentifier(request.headers),
      loginIdentifierLookup,
    );
    if (!attempt.allowed) {
      return noStoreJson(
        { error: "가입 요청이 너무 많습니다. 잠시 후 다시 시도해 주세요." },
        { status: 429, headers: { "Retry-After": String(Math.min(attempt.retryAfterSeconds, 900)) } },
      );
    }
    const availability = await registrationLoginIdAvailability(parsed.data.loginId);
    if (!availability.available) {
      await recordRegistrationResult({ success: false, accountLookup: availability.loginIdentifierLookup, ipLookup: attempt.ipLookup });
      return noStoreJson(
        { error: "이미 사용 중이거나 가입할 수 없는 아이디입니다." },
        { status: 409 },
      );
    }

    const passwordHash = await hashUserPassword(parsed.data.password);
    const id = randomUUID();
    await getPrisma().user.create({
      data: {
        id,
        loginIdentifierLookup: availability.loginIdentifierLookup,
        loginIdentifierEncrypted: encryptUserLoginIdentifier(id, availability.normalized),
        passwordHash,
        role: "STUDENT",
        registrationApprovalStatus: "PENDING",
        ...signupConsentData(),
      },
      select: { id: true },
    });
    await recordRegistrationResult({
      success: true,
      accountLookup: availability.loginIdentifierLookup,
      ipLookup: attempt.ipLookup,
      userId: id,
    });
    await notifyRegistrationApprovalRequested(id)
      .catch((error) => console.error("가입 승인 알림 생성 실패", error));

    return noStoreJson({ ok: true }, { status: 201 });
  } catch (error) {
    if (isLoginIdConflict(error)) {
      return noStoreJson(
        { error: "이미 사용 중이거나 가입할 수 없는 아이디입니다." },
        { status: 409 },
      );
    }
    return apiError(error, "회원가입을 완료하지 못했습니다.");
  }
}
