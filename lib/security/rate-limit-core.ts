// 고정 윈도 인메모리 rate limiter의 핵심 구현입니다. proxy.ts(미들웨어)와 Route Handler가
// 모두 쓰기 때문에 "server-only"를 붙이지 않습니다 — 요청 메타데이터만 다루고 DB·비밀키에는
// 접근하지 않습니다. 서버 전용 호출부는 lib/security/rate-limit.ts를 통해 가져다 씁니다.

type Bucket = { count: number; resetAt: number };

export type RateLimitDecision = { allowed: boolean; retryAfterSeconds: number };

const SWEEP_INTERVAL_MS = 5 * 60_000;
const MAX_ENTRIES = 5_000;

// 키가 계속 늘기만 하면(예: 공격자가 매 요청 다른 값을 자처하는 경우) Map이 무한정 쌓여
// 실질적인 메모리 누수·DoS가 되므로, 주기적으로 만료된 항목을 청소하고 그래도 넘치면 가장
// 오래 전에 등록된 항목부터 강제로 비웁니다. 프로세스 단일 인스턴스 운영 전제(structure.md §8)를
// 벗어나 다중 인스턴스로 확장하면 인스턴스별로 따로 세게 되므로 Redis 등 공유 저장소로 옮겨야 합니다.
export function createRateLimiter(options: { windowMs: number; maxAttempts: number }) {
  const attemptsByKey = new Map<string, Bucket>();

  function sweep() {
    const now = Date.now();
    for (const [key, bucket] of attemptsByKey) {
      if (bucket.resetAt <= now) attemptsByKey.delete(key);
    }
    const overflow = attemptsByKey.size - MAX_ENTRIES;
    if (overflow > 0) {
      let removed = 0;
      for (const key of attemptsByKey.keys()) {
        if (removed >= overflow) break;
        attemptsByKey.delete(key);
        removed += 1;
      }
    }
  }

  const timer = setInterval(sweep, SWEEP_INTERVAL_MS);
  timer.unref?.();

  return {
    peek(key: string): RateLimitDecision {
      const now = Date.now();
      const current = attemptsByKey.get(key);
      if (!current || current.resetAt <= now) return { allowed: true, retryAfterSeconds: 0 };
      if (current.count >= options.maxAttempts) {
        return { allowed: false, retryAfterSeconds: Math.max(1, Math.ceil((current.resetAt - now) / 1000)) };
      }
      return { allowed: true, retryAfterSeconds: 0 };
    },
    check(key: string): RateLimitDecision {
      const now = Date.now();
      const current = attemptsByKey.get(key);
      if (!current || current.resetAt <= now) {
        attemptsByKey.set(key, { count: 1, resetAt: now + options.windowMs });
        return { allowed: true, retryAfterSeconds: 0 };
      }
      if (current.count >= options.maxAttempts) {
        return { allowed: false, retryAfterSeconds: Math.max(1, Math.ceil((current.resetAt - now) / 1000)) };
      }
      current.count += 1;
      return { allowed: true, retryAfterSeconds: 0 };
    },
    consume(key: string) {
      return this.check(key).allowed;
    },
    reset(key: string) {
      attemptsByKey.delete(key);
    },
    /** 동적으로 만든 제한기를 폐기할 때 청소 타이머와 버킷을 함께 놓습니다. */
    dispose() {
      clearInterval(timer);
      attemptsByKey.clear();
    },
  };
}
