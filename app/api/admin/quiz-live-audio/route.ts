import { z } from "zod";
import { requireRole } from "@/lib/auth/authorization";
import { createAuditLogData } from "@/lib/auth/audit";
import { SYSTEM_SETTINGS_ID } from "@/lib/board/ownership-limit";
import { apiError, assertSameOrigin } from "@/lib/http";
import { readJsonWithLimit } from "@/lib/http-json";
import { getPrisma } from "@/lib/prisma";
import {
  invalidateQuizLiveAudioCache,
  publicQuizLiveAudioSettings,
  readStoredQuizLiveAudio,
  writeStoredQuizLiveAudio,
} from "@/lib/quiz/live-audio";

const volumeSchema = z.object({
  musicVolume: z.coerce.number().int().min(0).max(100),
  effectsVolume: z.coerce.number().int().min(0).max(100),
});
const VOLUME_BODY_MAX_BYTES = 4 * 1024;

export async function GET() {
  try {
    await requireRole(["SUPER_ADMIN"]);
    return Response.json(publicQuizLiveAudioSettings(await readStoredQuizLiveAudio()), {
      headers: { "Cache-Control": "private, no-store" },
    });
  } catch (error) {
    return apiError(error, "라이브 퀴즈 오디오 설정을 불러오지 못했습니다.");
  }
}

export async function PATCH(request: Request) {
  try {
    assertSameOrigin(request);
    const actor = await requireRole(["SUPER_ADMIN"]);
    const parsed = volumeSchema.safeParse(await readJsonWithLimit(request, VOLUME_BODY_MAX_BYTES));
    if (!parsed.success) {
      return Response.json({ error: "배경음악과 효과음 볼륨은 0~100 사이로 입력해 주세요." }, { status: 400 });
    }

    const prisma = getPrisma();
    // raw JSON 열을 잠그기 전에 싱글턴 행이 반드시 존재하게 합니다.
    await prisma.systemSetting.upsert({ where: { id: SYSTEM_SETTINGS_ID }, create: { id: SYSTEM_SETTINGS_ID }, update: {}, select: { id: true } });
    const updated = await prisma.$transaction(async (tx) => {
      await tx.$queryRaw<Array<{ id: string }>>`SELECT "id" FROM "SystemSetting" WHERE "id" = ${SYSTEM_SETTINGS_ID} FOR UPDATE`;
      const before = await readStoredQuizLiveAudio(tx);
      const next = { ...before, ...parsed.data };
      await writeStoredQuizLiveAudio(tx, next, actor.id);
      await tx.adminAuditLog.create({
        data: createAuditLogData({
          actorId: actor.id,
          action: "SYSTEM_SETTINGS_UPDATED",
          entityType: "SystemSetting",
          entityId: SYSTEM_SETTINGS_ID,
          before: { musicVolume: before.musicVolume, effectsVolume: before.effectsVolume },
          after: { musicVolume: next.musicVolume, effectsVolume: next.effectsVolume },
        }),
      });
      return next;
    });
    invalidateQuizLiveAudioCache();
    return Response.json(publicQuizLiveAudioSettings(updated));
  } catch (error) {
    return apiError(error, "라이브 퀴즈 오디오 볼륨을 저장하지 못했습니다.");
  }
}
