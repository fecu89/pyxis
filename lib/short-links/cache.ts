import { getPrisma } from "@/lib/prisma";
import { ShortLinkResolveBusyError } from "@/lib/short-links/errors";

type CachedDestination = { destination: string | null; expiresAt: number };
type PendingResolution = { version: number; promise: Promise<string | null> };

const CACHE_MAX_ENTRIES = 2_000;
const FOUND_TTL_MS = 30_000;
const MISSING_TTL_MS = 10_000;
const MAX_CONCURRENT_RESOLVES = 24;
const MAX_WAITING_RESOLVES = 96;
const destinationCache = new Map<string, CachedDestination>();
const pendingBySlug = new Map<string, PendingResolution>();
const versionsBySlug = new Map<string, number>();
const resolveWaiters: Array<() => void> = [];
let activeResolves = 0;

async function acquireResolveSlot() {
  if (activeResolves < MAX_CONCURRENT_RESOLVES) activeResolves += 1;
  else {
    if (resolveWaiters.length >= MAX_WAITING_RESOLVES) throw new ShortLinkResolveBusyError();
    await new Promise<void>((resolve) => resolveWaiters.push(resolve));
  }
  let released = false;
  return () => {
    if (released) return;
    released = true;
    const next = resolveWaiters.shift();
    if (next) next();
    else activeResolves -= 1;
  };
}

function remember(slug: string, destination: string | null) {
  destinationCache.delete(slug);
  destinationCache.set(slug, {
    destination,
    expiresAt: Date.now() + (destination ? FOUND_TTL_MS : MISSING_TTL_MS),
  });
  while (destinationCache.size > CACHE_MAX_ENTRIES) {
    const oldest = destinationCache.keys().next().value as string | undefined;
    if (!oldest) break;
    destinationCache.delete(oldest);
  }
}

export function invalidateShortLinkSlug(slug: string) {
  destinationCache.delete(slug);
  versionsBySlug.set(slug, (versionsBySlug.get(slug) ?? 0) + 1);
}

async function resolveUncachedDestination(slug: string, version: number) {
  const release = await acquireResolveSlot();
  try {
    const shortLink = await getPrisma().shortLink.findUnique({
      where: { slug },
      select: {
        disabledAt: true,
        targetType: true,
        board: { select: { slug: true, deletedAt: true } },
        form: { select: { slug: true, deletedAt: true } },
        quizSession: {
          select: {
            pinCode: true,
            status: true,
            quiz: { select: { deletedAt: true } },
          },
        },
      },
    });

    let destination: string | null = null;
    if (!shortLink?.disabledAt && shortLink?.targetType === "BOARD" && shortLink.board && !shortLink.board.deletedAt) {
      destination = `/b/${encodeURIComponent(shortLink.board.slug)}`;
    } else if (!shortLink?.disabledAt && shortLink?.targetType === "FORM" && shortLink.form && !shortLink.form.deletedAt) {
      destination = `/s/${encodeURIComponent(shortLink.form.slug)}`;
    } else if (
      !shortLink?.disabledAt
      && shortLink?.targetType === "QUIZ_SESSION"
      && shortLink.quizSession?.pinCode
      && shortLink.quizSession.status !== "FINISHED"
      && shortLink.quizSession.status !== "CANCELLED"
      && !shortLink.quizSession.quiz.deletedAt
    ) {
      destination = `/j/${encodeURIComponent(shortLink.quizSession.pinCode)}`;
    }

    // 저장 트랜잭션과 조회가 겹쳤다면 예전 결과를 캐시에 다시 넣지 않습니다.
    if ((versionsBySlug.get(slug) ?? 0) === version) remember(slug, destination);
    return destination;
  } finally {
    release();
  }
}

export async function resolveShortLinkDestination(slug: string) {
  const cached = destinationCache.get(slug);
  if (cached && cached.expiresAt > Date.now()) {
    destinationCache.delete(slug);
    destinationCache.set(slug, cached);
    return cached.destination;
  }
  if (cached) destinationCache.delete(slug);

  const version = versionsBySlug.get(slug) ?? 0;
  const pending = pendingBySlug.get(slug);
  if (pending?.version === version) return pending.promise;
  const resolution = resolveUncachedDestination(slug, version).finally(() => {
    if (pendingBySlug.get(slug)?.promise === resolution) pendingBySlug.delete(slug);
  });
  pendingBySlug.set(slug, { version, promise: resolution });
  return resolution;
}
