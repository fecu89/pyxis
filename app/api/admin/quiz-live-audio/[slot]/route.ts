import { unlink } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import path from "node:path";
import { requireRole } from "@/lib/auth/authorization";
import { createAuditLogData } from "@/lib/auth/audit";
import { SYSTEM_SETTINGS_ID } from "@/lib/board/ownership-limit";
import { getQuizLiveAudioDirectory, resolveStoredFile } from "@/lib/files/paths";
import { storeAttachmentUpload } from "@/lib/files/store-upload";
import { apiError, assertSameOrigin } from "@/lib/http";
import { getPrisma } from "@/lib/prisma";
import {
  invalidateQuizLiveAudioCache,
  publicQuizLiveAudioSettings,
  readStoredQuizLiveAudio,
  retireQuizLiveAudioTrack,
  writeStoredQuizLiveAudio,
} from "@/lib/quiz/live-audio";
import { isQuizLiveAudioSlot, QUIZ_LIVE_AUDIO_MAX_MB } from "@/lib/quiz/live-audio-shape";
import { assertRateLimit } from "@/lib/security/rate-limit";

const ALLOWED_AUDIO_EXTENSIONS = new Set([".mp3", ".m4a", ".wav"]);
const MAX_AUDIO_BYTES = QUIZ_LIVE_AUDIO_MAX_MB * 1024 * 1024;

function invalidSlot() {
  return Response.json({ error: "라이브 퀴즈 오디오 항목을 찾을 수 없습니다." }, { status: 404 });
}

export async function POST(request: Request, { params }: { params: Promise<{ slot: string }> }) {
  let cleanupNew: (() => Promise<void>) | null = null;
  try {
    assertSameOrigin(request);
    const actor = await requireRole(["SUPER_ADMIN"]);
    const { slot } = await params;
    if (!isQuizLiveAudioSlot(slot)) return invalidSlot();
    assertRateLimit(request, {
      scope: "admin-quiz-live-audio-upload",
      userId: actor.id,
      windowMs: 10 * 60_000,
      maxAttempts: 30,
      message: "라이브 퀴즈 음원을 너무 자주 변경했습니다. 잠시 후 다시 시도해 주세요.",
    });

    let stored: Awaited<ReturnType<typeof storeAttachmentUpload>>;
    try {
      stored = await storeAttachmentUpload(request, getQuizLiveAudioDirectory(), {
        allowedTypes: ["AUDIO"],
        maxBytes: MAX_AUDIO_BYTES,
        context: { target: `라이브 퀴즈 오디오(${slot})`, userId: actor.id },
      });
      cleanupNew = stored.cleanup;
      if (!ALLOWED_AUDIO_EXTENSIONS.has(path.extname(stored.data.originalName).toLowerCase())) {
        await stored.cleanup();
        cleanupNew = null;
        return Response.json({ error: "MP3, M4A, WAV 오디오만 올릴 수 있습니다." }, { status: 400 });
      }
    } catch {
      return Response.json({ error: `MP3, M4A, WAV 오디오를 ${QUIZ_LIVE_AUDIO_MAX_MB}MB 이하로 올려 주세요.` }, { status: 400 });
    }

    const prisma = getPrisma();
    await prisma.systemSetting.upsert({ where: { id: SYSTEM_SETTINGS_ID }, create: { id: SYSTEM_SETTINGS_ID }, update: {}, select: { id: true } });
    const result = await prisma.$transaction(async (tx) => {
      await tx.$queryRaw<Array<{ id: string }>>`SELECT "id" FROM "SystemSetting" WHERE "id" = ${SYSTEM_SETTINGS_ID} FOR UPDATE`;
      const before = await readStoredQuizLiveAudio(tx);
      const previous = before.tracks[slot];
      const retired = retireQuizLiveAudioTrack(before, slot, previous);
      const next = {
        ...before,
        retiredTracks: retired.retiredTracks,
        tracks: {
          ...before.tracks,
          [slot]: {
            originalName: stored.data.originalName,
            mimeType: stored.data.mimeType,
            fileSize: stored.data.fileSize,
            storagePath: stored.data.storagePath,
            revision: randomUUID(),
          },
        },
      };
      await writeStoredQuizLiveAudio(tx, next, actor.id);
      await tx.adminAuditLog.create({ data: createAuditLogData({
        actorId: actor.id,
        action: "SYSTEM_SETTINGS_UPDATED",
        entityType: "SystemSetting",
        entityId: SYSTEM_SETTINGS_ID,
        before: { quizLiveAudioSlot: slot, track: previous ? { originalName: previous.originalName, fileSize: previous.fileSize } : null },
        after: { quizLiveAudioSlot: slot, track: { originalName: stored.data.originalName, fileSize: stored.data.fileSize } },
      }) });
      return { next, expiredStoragePaths: retired.expiredStoragePaths };
    });
    cleanupNew = null;
    for (const storagePath of result.expiredStoragePaths) {
      if (storagePath !== stored.data.storagePath) {
        await unlink(/* turbopackIgnore: true */ resolveStoredFile(storagePath)).catch(() => undefined);
      }
    }
    invalidateQuizLiveAudioCache();
    return Response.json(publicQuizLiveAudioSettings(result.next), { status: 201 });
  } catch (error) {
    if (cleanupNew) await cleanupNew().catch(() => undefined);
    return apiError(error, "라이브 퀴즈 음원을 저장하지 못했습니다.");
  }
}

export async function DELETE(request: Request, { params }: { params: Promise<{ slot: string }> }) {
  try {
    assertSameOrigin(request);
    const actor = await requireRole(["SUPER_ADMIN"]);
    const { slot } = await params;
    if (!isQuizLiveAudioSlot(slot)) return invalidSlot();
    const prisma = getPrisma();
    await prisma.systemSetting.upsert({ where: { id: SYSTEM_SETTINGS_ID }, create: { id: SYSTEM_SETTINGS_ID }, update: {}, select: { id: true } });
    const result = await prisma.$transaction(async (tx) => {
      await tx.$queryRaw<Array<{ id: string }>>`SELECT "id" FROM "SystemSetting" WHERE "id" = ${SYSTEM_SETTINGS_ID} FOR UPDATE`;
      const before = await readStoredQuizLiveAudio(tx);
      const previous = before.tracks[slot];
      if (!previous) return { next: before, expiredStoragePaths: [] as string[] };
      const retired = retireQuizLiveAudioTrack(before, slot, previous);
      const next = { ...before, retiredTracks: retired.retiredTracks, tracks: { ...before.tracks, [slot]: null } };
      await writeStoredQuizLiveAudio(tx, next, actor.id);
      await tx.adminAuditLog.create({ data: createAuditLogData({
        actorId: actor.id,
        action: "SYSTEM_SETTINGS_UPDATED",
        entityType: "SystemSetting",
        entityId: SYSTEM_SETTINGS_ID,
        before: { quizLiveAudioSlot: slot, track: { originalName: previous.originalName, fileSize: previous.fileSize } },
        after: { quizLiveAudioSlot: slot, track: null },
      }) });
      return { next, expiredStoragePaths: retired.expiredStoragePaths };
    });
    for (const storagePath of result.expiredStoragePaths) {
      await unlink(/* turbopackIgnore: true */ resolveStoredFile(storagePath)).catch(() => undefined);
    }
    invalidateQuizLiveAudioCache();
    return Response.json(publicQuizLiveAudioSettings(result.next));
  } catch (error) {
    return apiError(error, "라이브 퀴즈 음원을 삭제하지 못했습니다.");
  }
}
