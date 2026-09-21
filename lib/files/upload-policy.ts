import "server-only";

import { SYSTEM_SETTINGS_ID } from "@/lib/board/ownership-limit";
import {
  UPLOAD_POLICY_BOUNDS,
  UPLOAD_POLICY_DEFAULTS,
  UPLOAD_POLICY_KEYS,
  type UploadPolicy,
  mb,
} from "@/lib/files/upload-policy-shape";
import { getPrisma } from "@/lib/prisma";

// 업로드 용량 상한의 단일 출처.
//
// 예전에는 같은 성격의 숫자가 세 군데에 흩어져 있었습니다 — 코드 상수(`GUEST_MAX_UPLOAD_BYTES`,
// 배경 10MB, 퀴즈 이미지 8MB), 환경 변수(`MAX_UPLOAD_SIZE_MB`), 그리고 클라이언트 쪽 형식별 캡.
// 학교마다 디스크 사정이 다른데 바꾸려면 재배포가 필요했고, 서버와 클라이언트 값이 갈라지면
// "파일 선택창은 받아 주는데 서버가 거절하는" 상태가 됩니다. 여기 한 벌만 두고 양쪽이 읽습니다.
//
// 우선순위는 DB > 환경 변수 > 코드 기본값입니다. 환경 변수를 남겨 둔 이유는 기존 배포가 이미
// `MAX_UPLOAD_SIZE_MB`로 값을 정해 두었을 수 있어서입니다 — 관리 화면에서 한 번도 저장하지
// 않았다면 그 값이 계속 쓰입니다.

export type { UploadPolicy } from "@/lib/files/upload-policy-shape";
export { UPLOAD_POLICY_BOUNDS, UPLOAD_POLICY_DEFAULTS, UPLOAD_POLICY_KEYS, mb } from "@/lib/files/upload-policy-shape";

function clampMb(key: keyof UploadPolicy, value: number | null | undefined) {
  const bounds = UPLOAD_POLICY_BOUNDS[key];
  if (value === null || value === undefined || !Number.isFinite(value)) return null;
  return Math.min(bounds.max, Math.max(bounds.min, Math.floor(value)));
}

function fromEnv(key: keyof UploadPolicy, name: string) {
  const raw = process.env[name];
  if (raw === undefined || raw === "") return null;
  return clampMb(key, Number(raw));
}

// 옮기기 전 배포가 쓰던 환경 변수. DB에 값이 없을 때만 봅니다.
const ENV_FALLBACKS: Partial<Record<keyof UploadPolicy, string>> = {
  maxUploadMb: "MAX_UPLOAD_SIZE_MB",
  maxQuizImageStorageMb: "MAX_QUIZ_IMAGE_STORAGE_MB",
};

// 업로드 한 번에 정책을 한 번씩 읽으면 파일 하나당 DB 왕복이 늘어납니다. 값이 바뀌는 일은
// 드물어서 짧게 캐시하고, 관리 화면이 저장할 때 즉시 비웁니다(그래야 저장 직후 화면에서
// 다시 시험해 볼 때 옛 값으로 거절당하지 않습니다).
const CACHE_TTL_MS = 30_000;
let cached: { value: UploadPolicy; expiresAt: number } | null = null;

export function invalidateUploadPolicyCache() {
  cached = null;
}

export async function getUploadPolicy(options: { fresh?: boolean } = {}): Promise<UploadPolicy> {
  if (!options.fresh && cached && cached.expiresAt > Date.now()) return cached.value;

  let row: Partial<UploadPolicy> | null = null;
  try {
    row = await getPrisma().systemSetting.findUnique({
      where: { id: SYSTEM_SETTINGS_ID },
      select: {
        maxUploadMb: true,
        guestMaxUploadMb: true,
        maxImageUploadMb: true,
        maxBoardBackgroundMb: true,
        maxQuizImageMb: true,
        maxQuizImageStorageMb: true,
      },
    });
  } catch {
    // DB를 잠깐 못 읽는다고 업로드를 통째로 막지는 않습니다. 기본값으로 계속 동작하고,
    // 캐시에 담지 않으므로 다음 요청이 다시 시도합니다.
    return resolve(null);
  }

  const value = resolve(row);
  cached = { value, expiresAt: Date.now() + CACHE_TTL_MS };
  return value;
}

function resolve(row: Partial<UploadPolicy> | null): UploadPolicy {
  const resolved = {} as UploadPolicy;
  for (const key of UPLOAD_POLICY_KEYS) {
    const envName = ENV_FALLBACKS[key];
    resolved[key] = clampMb(key, row?.[key])
      ?? (envName ? fromEnv(key, envName) : null)
      ?? UPLOAD_POLICY_DEFAULTS[key];
  }
  // 개별 상한이 전체 상한보다 크면 사용자는 "받아 준다"고 안내받고 서버에서 거절당합니다.
  // 관리 화면에서도 막지만, 환경 변수로만 전체 상한을 낮춘 배포에서도 어긋나지 않도록
  // 읽는 쪽에서 한 번 더 맞춥니다.
  const ceiling = resolved.maxUploadMb;
  resolved.guestMaxUploadMb = Math.min(resolved.guestMaxUploadMb, ceiling);
  resolved.maxImageUploadMb = Math.min(resolved.maxImageUploadMb, ceiling);
  resolved.maxBoardBackgroundMb = Math.min(resolved.maxBoardBackgroundMb, ceiling);
  resolved.maxQuizImageMb = Math.min(resolved.maxQuizImageMb, ceiling);
  return resolved;
}

/** 첨부 전체 상한(바이트). 예전 `maxUploadBytes()`를 대신합니다. */
export async function maxUploadBytes() {
  return mb((await getUploadPolicy()).maxUploadMb);
}

/** 손님 업로드 상한(바이트). 전체 상한과 함께 작은 쪽이 적용됩니다. */
export async function guestMaxUploadBytes() {
  const policy = await getUploadPolicy();
  return mb(Math.min(policy.guestMaxUploadMb, policy.maxUploadMb));
}
