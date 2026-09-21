import "server-only";

import { Prisma, type AuthSecurityEventType } from "@/generated/prisma/client";
import { getPrisma } from "@/lib/prisma";
import { createAuthSecurityLookup } from "@/lib/security/pii-crypto";

const MINUTE = 60_000;
const DAY = 24 * 60 * MINUTE;
const EVENT_RETENTION_MS = 90 * DAY;
const SERIALIZABLE_RETRIES = 3;

// 학교·기관 NAT에서는 수백 명이 같은 IP로 정상 로그인할 수 있습니다. IP 버킷에는 성공 시도는
// 넣지 않고 비밀번호 실패만 누적합니다. 한 IP의 계정 대입 공격은 막되 정상 동시 로그인을 막지 않습니다.
const LOGIN_IP_FAILURE_POLICY = { max: 90, windowMs: 5 * MINUTE };
const LOGIN_PAIR_POLICY = { max: 8, windowMs: 10 * MINUTE };
const REGISTER_IP_POLICY = { max: 30, windowMs: 15 * MINUTE };
const REGISTER_ACCOUNT_POLICY = { max: 4, windowMs: 15 * MINUTE };
const LOGIN_ID_CHECK_IP_POLICY = { max: 60, windowMs: 10 * MINUTE };
const LOGIN_ID_CHECK_ACCOUNT_POLICY = { max: 10, windowMs: 10 * MINUTE };
const ACCOUNT_FAILURE_WINDOW_MS = 15 * MINUTE;

type RateLimitResult = { allowed: true } | { allowed: false; retryAfterSeconds: number };
type CredentialAttempt = RateLimitResult & {
  accountLookup: string;
  ipLookup: string;
  ipFailureKey: string;
  pairKey: string;
  accountKey: string;
};

let lastCleanupAt = 0;

function retryableTransactionError(error: unknown) {
  if (error instanceof Prisma.PrismaClientKnownRequestError) {
    return error.code === "P2002" || error.code === "P2034";
  }
  const candidate = error as {
    message?: unknown;
    cause?: { originalCode?: unknown; kind?: unknown };
  } | null;
  return candidate?.cause?.originalCode === "40001"
    || candidate?.cause?.kind === "TransactionWriteConflict"
    || (typeof candidate?.message === "string" && candidate.message.includes("TransactionWriteConflict"));
}

async function serializable<T>(work: (tx: Prisma.TransactionClient) => Promise<T>) {
  let lastError: unknown;
  for (let attempt = 0; attempt < SERIALIZABLE_RETRIES; attempt += 1) {
    try {
      return await getPrisma().$transaction(work, { isolationLevel: "Serializable" });
    } catch (error) {
      lastError = error;
      if (!retryableTransactionError(error) || attempt === SERIALIZABLE_RETRIES - 1) throw error;
    }
  }
  throw lastError;
}

function secondsUntil(date: Date, now: Date) {
  return Math.max(1, Math.ceil((date.getTime() - now.getTime()) / 1_000));
}

async function consumeFixedWindow(key: string, category: string, policy: { max: number; windowMs: number }): Promise<RateLimitResult> {
  return serializable(async (tx) => {
    const now = new Date();
    const expiresAt = new Date(now.getTime() + policy.windowMs);
    const current = await tx.authRateLimit.findUnique({ where: { key } });
    if (!current) {
      await tx.authRateLimit.create({
        data: { key, category, count: 1, windowStartedAt: now, expiresAt },
      });
      return { allowed: true };
    }
    if (current.expiresAt <= now) {
      await tx.authRateLimit.update({
        where: { key },
        data: { category, count: 1, windowStartedAt: now, blockedUntil: null, expiresAt },
      });
      return { allowed: true };
    }
    if (current.count >= policy.max) {
      return { allowed: false, retryAfterSeconds: secondsUntil(current.expiresAt, now) };
    }
    await tx.authRateLimit.update({ where: { key }, data: { count: { increment: 1 } } });
    return { allowed: true };
  });
}

function accountCooldownMs(failureCount: number) {
  if (failureCount >= 8) return 30 * MINUTE;
  if (failureCount === 7) return 10 * MINUTE;
  if (failureCount === 6) return 2 * MINUTE;
  if (failureCount === 5) return 30_000;
  return 0;
}

async function checkCredentialFailureWindows(ipFailureKey: string, accountKey: string) {
  const rows = await getPrisma().authRateLimit.findMany({
    where: { key: { in: [ipFailureKey, accountKey] } },
  });
  const byKey = new Map(rows.map((row) => [row.key, row]));
  const now = new Date();
  const ip = byKey.get(ipFailureKey);
  const account = byKey.get(accountKey);
  const ipResult: RateLimitResult = !ip || ip.expiresAt <= now || ip.count < LOGIN_IP_FAILURE_POLICY.max
    ? { allowed: true }
    : { allowed: false, retryAfterSeconds: secondsUntil(ip.expiresAt, now) };
  const accountResult: RateLimitResult = !account || account.expiresAt <= now || !account.blockedUntil || account.blockedUntil <= now
    ? { allowed: true }
    : { allowed: false, retryAfterSeconds: secondsUntil(account.blockedUntil, now) };
  return { ipResult, accountResult };
}

async function incrementAccountFailure(accountKey: string) {
  return serializable(async (tx) => {
    const now = new Date();
    const current = await tx.authRateLimit.findUnique({ where: { key: accountKey } });
    const reset = !current || current.expiresAt <= now;
    const count = reset ? 1 : current.count + 1;
    const cooldownMs = accountCooldownMs(count);
    const blockedUntil = cooldownMs ? new Date(now.getTime() + cooldownMs) : null;
    const windowEnd = reset
      ? new Date(now.getTime() + ACCOUNT_FAILURE_WINDOW_MS)
      : current.expiresAt;
    const expiresAt = blockedUntil && blockedUntil > windowEnd ? blockedUntil : windowEnd;
    await tx.authRateLimit.upsert({
      where: { key: accountKey },
      create: {
        key: accountKey,
        category: "login-account-failure",
        count,
        windowStartedAt: now,
        blockedUntil,
        expiresAt,
      },
      update: {
        category: "login-account-failure",
        count,
        ...(reset ? { windowStartedAt: now } : {}),
        blockedUntil,
        expiresAt,
      },
    });
  });
}

function eventKey(type: AuthSecurityEventType, accountLookup: string | null, ipLookup: string, now: Date) {
  const hour = now.toISOString().slice(0, 13);
  return createAuthSecurityLookup("event", `${type}:${accountLookup ?? "none"}:${ipLookup}:${hour}`);
}

async function cleanupExpiredState(now: Date) {
  if (now.getTime() - lastCleanupAt < 60 * MINUTE) return;
  lastCleanupAt = now.getTime();
  await Promise.all([
    getPrisma().authRateLimit.deleteMany({ where: { expiresAt: { lte: now } } }),
    getPrisma().authSecurityEvent.deleteMany({ where: { expiresAt: { lte: now } } }),
  ]).catch((error) => console.error("만료된 인증 보안 상태 정리 실패", error));
}

async function recordSecurityEvent(input: {
  type: AuthSecurityEventType;
  accountLookup?: string | null;
  ipLookup: string;
  userId?: string | null;
}) {
  const now = new Date();
  const key = eventKey(input.type, input.accountLookup ?? null, input.ipLookup, now);
  await getPrisma().authSecurityEvent.upsert({
    where: { key },
    create: {
      key,
      type: input.type,
      accountLookup: input.accountLookup ?? null,
      ipLookup: input.ipLookup,
      userId: input.userId ?? null,
      expiresAt: new Date(now.getTime() + EVENT_RETENTION_MS),
    },
    update: {
      count: { increment: 1 },
      userId: input.userId ?? undefined,
      expiresAt: new Date(now.getTime() + EVENT_RETENTION_MS),
    },
  }).catch((error) => console.error("인증 보안 이벤트 기록 실패", error));
  await cleanupExpiredState(now);
}

function rateKey(category: string, value: string) {
  return createAuthSecurityLookup(`rate:${category}`, value);
}

export async function prepareCredentialAttempt(clientIdentifier: string, accountLookup: string): Promise<CredentialAttempt> {
  const ipLookup = createAuthSecurityLookup("ip", clientIdentifier);
  const ipFailureKey = rateKey("login-ip-failure", ipLookup);
  const pairKey = rateKey("login-pair", `${ipLookup}:${accountLookup}`);
  const accountKey = rateKey("login-account-failure", accountLookup);
  // 조회만 하고 성공 시도에는 count를 더하지 않습니다. 실패가 확인된 뒤 아래
  // recordCredentialFailure가 이 버킷을 소비합니다.
  const [failureWindows, pairResult] = await Promise.all([
    checkCredentialFailureWindows(ipFailureKey, accountKey),
    consumeFixedWindow(pairKey, "login-pair", LOGIN_PAIR_POLICY),
  ]);
  const { ipResult, accountResult } = failureWindows;
  const blocked = !ipResult.allowed ? ipResult : !pairResult.allowed ? pairResult : !accountResult.allowed ? accountResult : null;
  if (blocked) {
    await recordSecurityEvent({ type: "LOGIN_RATE_LIMITED", accountLookup, ipLookup });
    return { ...blocked, accountLookup, ipLookup, ipFailureKey, pairKey, accountKey };
  }
  return { allowed: true, accountLookup, ipLookup, ipFailureKey, pairKey, accountKey };
}

export async function recordCredentialFailure(attempt: CredentialAttempt) {
  await Promise.all([
    incrementAccountFailure(attempt.accountKey),
    consumeFixedWindow(attempt.ipFailureKey, "login-ip-failure", LOGIN_IP_FAILURE_POLICY),
  ]);
  await recordSecurityEvent({ type: "LOGIN_FAILURE", accountLookup: attempt.accountLookup, ipLookup: attempt.ipLookup });
}

export async function recordCredentialSuccess(attempt: CredentialAttempt, accountLookup: string, userId: string) {
  await getPrisma().authRateLimit.deleteMany({
    where: { key: { in: [attempt.accountKey, attempt.pairKey] } },
  }).catch((error) => console.error("성공한 로그인 제한 상태 초기화 실패", error));
  await recordSecurityEvent({ type: "LOGIN_SUCCESS", accountLookup, ipLookup: attempt.ipLookup, userId });
}

export async function prepareRegistrationAttempt(clientIdentifier: string, accountLookup: string) {
  const ipLookup = createAuthSecurityLookup("ip", clientIdentifier);
  const ipResult = await consumeFixedWindow(rateKey("register-ip", ipLookup), "register-ip", REGISTER_IP_POLICY);
  const accountResult = ipResult.allowed
    ? await consumeFixedWindow(rateKey("register-account", accountLookup), "register-account", REGISTER_ACCOUNT_POLICY)
    : { allowed: true } as const;
  const result = !ipResult.allowed ? ipResult : accountResult;
  if (!result.allowed) await recordSecurityEvent({ type: "REGISTER_RATE_LIMITED", accountLookup, ipLookup });
  return { ...result, ipLookup };
}

export async function prepareLoginIdAvailabilityCheck(clientIdentifier: string, accountLookup: string) {
  const ipLookup = createAuthSecurityLookup("ip", clientIdentifier);
  const ipResult = await consumeFixedWindow(rateKey("login-id-check-ip", ipLookup), "login-id-check-ip", LOGIN_ID_CHECK_IP_POLICY);
  const accountResult = ipResult.allowed
    ? await consumeFixedWindow(rateKey("login-id-check-account", accountLookup), "login-id-check-account", LOGIN_ID_CHECK_ACCOUNT_POLICY)
    : { allowed: true } as const;
  return !ipResult.allowed ? ipResult : accountResult;
}

export async function recordRegistrationResult(input: {
  success: boolean;
  accountLookup: string;
  ipLookup: string;
  userId?: string;
}) {
  await recordSecurityEvent({
    type: input.success ? "REGISTER_SUCCESS" : "REGISTER_REJECTED",
    accountLookup: input.accountLookup,
    ipLookup: input.ipLookup,
    userId: input.userId,
  });
}
