import { getPrisma } from "@/lib/prisma";
import {
  PLATFORM_SECURITY_POLICY_BOUNDS,
  PLATFORM_SECURITY_POLICY_DEFAULTS,
  PLATFORM_SECURITY_POLICY_KEYS,
  type PlatformSecurityPolicy,
} from "@/lib/security/platform-policy-shape";

export type { PlatformSecurityPolicy } from "@/lib/security/platform-policy-shape";
export {
  PLATFORM_SECURITY_POLICY_BOUNDS,
  PLATFORM_SECURITY_POLICY_DEFAULTS,
  PLATFORM_SECURITY_POLICY_KEYS,
} from "@/lib/security/platform-policy-shape";

const SYSTEM_SETTINGS_ID = "default";
// 커스텀 Socket.IO 서버(server.ts)와 Next Route Handler가 함께 읽는 정책이라 `server-only`
// 가드는 붙이지 않습니다. 클라이언트는 DB가 없는 shape 모듈만 import합니다.
const CACHE_TTL_MS = 30_000;
let cached: { value: PlatformSecurityPolicy; expiresAt: number } | null = null;
let generation = 0;
let pendingLoad: { generation: number; promise: Promise<PlatformSecurityPolicy> } | null = null;

function resolvePolicy(row: Partial<PlatformSecurityPolicy> | null): PlatformSecurityPolicy {
  const resolved = {} as PlatformSecurityPolicy;
  for (const key of PLATFORM_SECURITY_POLICY_KEYS) {
    const bounds = PLATFORM_SECURITY_POLICY_BOUNDS[key];
    const value = row?.[key];
    resolved[key] = typeof value === "number" && Number.isFinite(value)
      ? Math.min(bounds.max, Math.max(bounds.min, Math.floor(value)))
      : PLATFORM_SECURITY_POLICY_DEFAULTS[key];
  }
  return resolved;
}

export function invalidatePlatformSecurityPolicyCache() {
  cached = null;
  generation += 1;
}

export async function getPlatformSecurityPolicy(
  options: { fresh?: boolean } = {},
): Promise<PlatformSecurityPolicy> {
  if (!options.fresh && cached && cached.expiresAt > Date.now()) return cached.value;
  if (!options.fresh && pendingLoad?.generation === generation) return pendingLoad.promise;

  const loadGeneration = generation;
  let loadedFromDatabase = false;
  const promise = (async () => {
    try {
      const row = await getPrisma().systemSetting.findUnique({
        where: { id: SYSTEM_SETTINGS_ID },
        select: {
          adminReauthWindowMinutes: true,
          publicQuizJoinPerMinute: true,
          publicQuizApiRequestsPerMinute: true,
          publicQuizSocketEventsPerMinute: true,
          publicQuizSocketMaxConnections: true,
          publicQuizSocketConnectionsPerIp: true,
          publicQuizSocketConnectionsPerParticipant: true,
        },
      });
      loadedFromDatabase = true;
      return resolvePolicy(row);
    } catch {
      // DB가 잠깐 실패했을 때도 호출자는 안전한 기본값으로 계속 동작하되, 그 값을 30초 동안
      // 정상 정책처럼 캐시하지는 않습니다. 다음 요청이 곧바로 DB 복구를 확인할 수 있어야 합니다.
      return resolvePolicy(null);
    }
  })();
  if (!options.fresh) pendingLoad = { generation: loadGeneration, promise };

  try {
    const value = await promise;
    if (loadedFromDatabase && generation === loadGeneration) {
      cached = { value, expiresAt: Date.now() + CACHE_TTL_MS };
    }
    return value;
  } finally {
    if (pendingLoad?.promise === promise) pendingLoad = null;
  }
}
