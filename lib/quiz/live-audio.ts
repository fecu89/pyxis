import "server-only";

import { z } from "zod";
import type { Prisma } from "@/generated/prisma/client";
import { SYSTEM_SETTINGS_ID } from "@/lib/board/ownership-limit";
import { getPrisma } from "@/lib/prisma";
import {
  QUIZ_LIVE_AUDIO_DEFAULTS,
  QUIZ_LIVE_AUDIO_SLOTS,
  type QuizLiveAudioSettings,
  type QuizLiveAudioSlot,
} from "@/lib/quiz/live-audio-shape";

const storedTrackSchema = z.object({
  originalName: z.string().min(1).max(255),
  mimeType: z.string().startsWith("audio/").max(100),
  fileSize: z.number().int().positive(),
  storagePath: z.string().min(1).max(1024),
  revision: z.string().min(1).max(40),
});

const storedSettingsSchema = z.object({
  version: z.literal(1),
  musicVolume: z.number().int().min(0).max(100),
  effectsVolume: z.number().int().min(0).max(100),
  tracks: z.object({
    lobbyMusic: storedTrackSchema.nullable(),
    gameMusic: storedTrackSchema.nullable(),
    startBell: storedTrackSchema.nullable(),
    countdownBeep: storedTrackSchema.nullable(),
    scoreTick: storedTrackSchema.nullable(),
    finishBell: storedTrackSchema.nullable(),
    podiumFanfare: storedTrackSchema.nullable(),
  }),
  // revision URL을 immutable로 내보내므로 설정 교체 직후에도 이미 열린 수업의 range 요청을
  // 받아야 합니다. 최근 교체본만 JSON에 남기고 그보다 오래된 파일은 커밋 뒤 정리합니다.
  retiredTracks: z.array(z.object({
    slot: z.enum(QUIZ_LIVE_AUDIO_SLOTS),
    retiredAt: z.string().datetime(),
    track: storedTrackSchema,
  })).max(64).default([]),
});

export type StoredQuizLiveAudioTrack = z.infer<typeof storedTrackSchema>;
export type StoredQuizLiveAudioSettings = z.infer<typeof storedSettingsSchema>;

export const STORED_QUIZ_LIVE_AUDIO_DEFAULTS: StoredQuizLiveAudioSettings = {
  version: 1,
  musicVolume: QUIZ_LIVE_AUDIO_DEFAULTS.musicVolume,
  effectsVolume: QUIZ_LIVE_AUDIO_DEFAULTS.effectsVolume,
  tracks: {
    lobbyMusic: null,
    gameMusic: null,
    startBell: null,
    countdownBeep: null,
    scoreTick: null,
    finishBell: null,
    podiumFanfare: null,
  },
  retiredTracks: [],
};

const MAX_RETIRED_TRACKS = 14;

type QuizAudioQueryClient = Pick<Prisma.TransactionClient, "$queryRaw">;
type QuizAudioWriteClient = Pick<Prisma.TransactionClient, "$executeRaw">;

export function parseStoredQuizLiveAudio(value: unknown): StoredQuizLiveAudioSettings {
  const parsed = storedSettingsSchema.safeParse(value);
  return parsed.success ? parsed.data : STORED_QUIZ_LIVE_AUDIO_DEFAULTS;
}

export async function readStoredQuizLiveAudio(
  client: QuizAudioQueryClient = getPrisma(),
): Promise<StoredQuizLiveAudioSettings> {
  // prisma generate 전에도 migration과 소스가 함께 배포될 수 있도록 새 JSON 열만 raw query로
  // 읽습니다. 다음 generate 뒤에도 같은 쿼리는 타입·동작이 그대로입니다.
  const rows = await client.$queryRaw<Array<{ quizLiveAudio: unknown }>>`
    SELECT "quizLiveAudio" FROM "SystemSetting" WHERE "id" = ${SYSTEM_SETTINGS_ID} LIMIT 1
  `;
  return parseStoredQuizLiveAudio(rows[0]?.quizLiveAudio);
}

export async function writeStoredQuizLiveAudio(
  client: QuizAudioWriteClient,
  settings: StoredQuizLiveAudioSettings,
  updatedById: string,
) {
  const serialized = JSON.stringify(settings);
  await client.$executeRaw`
    UPDATE "SystemSetting"
    SET "quizLiveAudio" = ${serialized}::jsonb,
        "updatedById" = ${updatedById},
        "updatedAt" = NOW()
    WHERE "id" = ${SYSTEM_SETTINGS_ID}
  `;
}

export function publicQuizLiveAudioSettings(settings: StoredQuizLiveAudioSettings): QuizLiveAudioSettings {
  const tracks = Object.fromEntries(QUIZ_LIVE_AUDIO_SLOTS.map((slot) => {
    const track = settings.tracks[slot];
    return [slot, track
      ? {
          originalName: track.originalName,
          mimeType: track.mimeType,
          fileSize: track.fileSize,
          revision: track.revision,
          url: `/api/quiz/live-audio/${slot}?v=${encodeURIComponent(track.revision)}`,
        }
      : null];
  })) as QuizLiveAudioSettings["tracks"];
  return { musicVolume: settings.musicVolume, effectsVolume: settings.effectsVolume, tracks };
}

type LiveAudioCache = { value: StoredQuizLiveAudioSettings; expiresAt: number };
type LiveAudioLoad = { generation: number; promise: Promise<StoredQuizLiveAudioSettings> };
const globalForQuizAudio = globalThis as unknown as {
  pyxQuizLiveAudioCache?: LiveAudioCache;
  pyxQuizLiveAudioLoad?: LiveAudioLoad;
  pyxQuizLiveAudioGeneration?: number;
};
const CACHE_MS = 30_000;

export function invalidateQuizLiveAudioCache() {
  delete globalForQuizAudio.pyxQuizLiveAudioCache;
  globalForQuizAudio.pyxQuizLiveAudioGeneration = (globalForQuizAudio.pyxQuizLiveAudioGeneration ?? 0) + 1;
}

export async function getStoredQuizLiveAudio(): Promise<StoredQuizLiveAudioSettings> {
  const cached = globalForQuizAudio.pyxQuizLiveAudioCache;
  if (cached && cached.expiresAt > Date.now()) return cached.value;
  const generation = globalForQuizAudio.pyxQuizLiveAudioGeneration ?? 0;
  const currentLoad = globalForQuizAudio.pyxQuizLiveAudioLoad;
  if (currentLoad?.generation === generation) return currentLoad.promise;

  // 한 반이 동시에 플레이 페이지를 열 때 캐시가 비어 있어도 설정 SELECT는 한 번만 수행합니다.
  // 관리자가 그 사이 설정을 바꾸면 generation이 달라져 오래된 조회가 새 캐시를 덮지 않습니다.
  const promise = readStoredQuizLiveAudio();
  globalForQuizAudio.pyxQuizLiveAudioLoad = { generation, promise };
  try {
    const value = await promise;
    if ((globalForQuizAudio.pyxQuizLiveAudioGeneration ?? 0) === generation) {
      globalForQuizAudio.pyxQuizLiveAudioCache = { value, expiresAt: Date.now() + CACHE_MS };
    }
    return value;
  } finally {
    if (globalForQuizAudio.pyxQuizLiveAudioLoad?.promise === promise) {
      delete globalForQuizAudio.pyxQuizLiveAudioLoad;
    }
  }
}

export async function getPublicQuizLiveAudioSettings(): Promise<QuizLiveAudioSettings> {
  return publicQuizLiveAudioSettings(await getStoredQuizLiveAudio());
}

export function storedQuizLiveAudioTrack(
  settings: StoredQuizLiveAudioSettings,
  slot: QuizLiveAudioSlot,
  revision: string,
) {
  const current = settings.tracks[slot];
  if (current?.revision === revision) return current;
  return settings.retiredTracks.find((entry) => entry.slot === slot && entry.track.revision === revision)?.track ?? null;
}

/** 현재 파일을 immutable URL 유예 목록으로 옮기고, 상한 밖 파일 경로를 정리 대상으로 돌려줍니다. */
export function retireQuizLiveAudioTrack(
  settings: StoredQuizLiveAudioSettings,
  slot: QuizLiveAudioSlot,
  track: StoredQuizLiveAudioTrack | null,
) {
  if (!track) return { retiredTracks: settings.retiredTracks, expiredStoragePaths: [] as string[] };
  const all = [...settings.retiredTracks, { slot, retiredAt: new Date().toISOString(), track }];
  const expired = all.slice(0, Math.max(0, all.length - MAX_RETIRED_TRACKS));
  return {
    retiredTracks: all.slice(-MAX_RETIRED_TRACKS),
    expiredStoragePaths: expired.map((entry) => entry.track.storagePath),
  };
}
