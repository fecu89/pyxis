import {
  canArchiveBoard,
  canManageBoardSettings,
  getEffectiveBoardAccess,
  requireActiveUser,
} from "@/lib/auth/authorization";
import { createAuditLogData } from "@/lib/auth/audit";
import { syncActivity } from "@/lib/activity/ensure";
import { encryptBoardPasswordSecret, hashBoardPassword } from "@/lib/board/board-password";
import { normalizeBoardAccessSettings, updateBoardSchema } from "@/lib/board/validators";
import { apiError, assertSameOrigin } from "@/lib/http";
import { readJsonWithLimit } from "@/lib/http-json";
import { getPrisma } from "@/lib/prisma";
import { publishBoardEvent } from "@/lib/realtime/board-events";
import { defaultPostFieldConfig } from "@/lib/post-fields/defaults";
import { parsePostFieldConfig, PostFieldValidationError } from "@/lib/post-fields/validation";
import { assertRateLimit } from "@/lib/security/rate-limit";

const BOARD_PATCH_BODY_MAX_BYTES = 256 * 1024;

export async function PATCH(request: Request, { params }: { params: Promise<{ boardId: string }> }) {
  try {
    assertSameOrigin(request);
    const user = await requireActiveUser();
    const { boardId } = await params;
    const access = await getEffectiveBoardAccess(boardId, user);
    if (!access || !canManageBoardSettings(user, access)) return Response.json({ error: "패드 관리 권한이 없습니다." }, { status: 403 });
    const parsed = updateBoardSchema.safeParse(await readJsonWithLimit(request, BOARD_PATCH_BODY_MAX_BYTES));
    if (!parsed.success) return Response.json({ error: "패드 정보를 확인해 주세요." }, { status: 400 });
    const globalOverride = !["OWNER", "ADMIN"].includes(access.role ?? "");
    const { password, freezeAt, postFieldConfig, ...rest } = parsed.data;
    if (password !== undefined) {
      assertRateLimit(request, {
        scope: `board-password-change:${boardId}`,
        userId: user.id,
        windowMs: 10 * 60_000,
        maxAttempts: 10,
        message: "비밀번호 변경 요청이 너무 잦습니다. 잠시 후 다시 시도해 주세요.",
      });
    }
    const nextPasswordHash = typeof password === "string" ? await hashBoardPassword(password) : null;
    const normalizedAccess = normalizeBoardAccessSettings({
      discoveryScope: rest.discoveryScope ?? access.board.discoveryScope,
      visitorPermission: rest.visitorPermission ?? access.board.visitorPermission,
      loginRequired: rest.loginRequired ?? access.board.loginRequired,
    }, rest);
    const data = {
      ...rest,
      // LINK의 기본 읽기와 명시적 손님 쓰기를 정규화하며, 무관한 PATCH는 쓰기 설정을 유지합니다.
      ...(normalizedAccess.discoveryScope === "LINK"
        ? { visitorPermission: normalizedAccess.visitorPermission, loginRequired: normalizedAccess.loginRequired }
        : {}),
      ...(postFieldConfig !== undefined ? { postFieldConfig: parsePostFieldConfig(postFieldConfig) } : {}),
      ...(Object.hasOwn(parsed.data, "description") ? { description: parsed.data.description || null } : {}),
      // password: 문자열이면 해시로 교체, null이면 보호 해제, undefined(생략)면 손대지 않음.
      ...(password !== undefined ? {
        passwordHash: nextPasswordHash,
        passwordEncrypted: password === null ? null : encryptBoardPasswordSecret(boardId, password),
      } : {}),
      ...(freezeAt !== undefined ? { freezeAt: freezeAt === null ? null : new Date(freezeAt) } : {}),
    };
    const board = await getPrisma().$transaction(async (transaction) => {
      const updated = await transaction.board.update({
        where: { id: boardId },
        data,
        select: { id: true, activityId: true, title: true, description: true, discoveryScope: true, visitorPermission: true, loginRequired: true, passwordHash: true, state: true, moderationMode: true, guestPostsRequireApproval: true, freezeAt: true, layout: true, sortMode: true, newPostPlacement: true, cardSize: true, font: true, backgroundColor: true, backgroundImageUrl: true, accentColor: true, showAuthor: true, showTimestamp: true, reactionPolicy: true, attachmentDownloadPolicy: true, postFieldConfig: true, allowComments: true, allowReactions: true, allowMemberPosting: true, allowMemberFileUpload: true },
      });
      if (Object.hasOwn(parsed.data, "title")) {
        await syncActivity(transaction, updated.activityId, { title: updated.title });
      }
      if (globalOverride) {
        await transaction.adminAuditLog.create({ data: createAuditLogData({ actorId: user.id, action: "GLOBAL_BOARD_UPDATED", entityType: "Board", entityId: boardId, after: { fields: Object.keys(parsed.data) }, reason: "전역 권한으로 패드 설정 변경" }) });
      }
      return updated;
    });
    const { activityId, passwordHash, freezeAt: updatedFreezeAt, ...boardWithoutHash } = board;
    // 내부 리포트 연결 키는 응답·실시간 이벤트에 싣지 않습니다.
    void activityId;
    const boardPatch = {
      ...boardWithoutHash,
      hasPassword: Boolean(passwordHash),
      // 게시물 필드를 한 번도 설정하지 않은 과거 패드는 DB 값이 null입니다. 공개 범위나
      // 비밀번호만 고친 요청까지 응답 직렬화 단계에서 실패하지 않도록 기본 설정으로 해석합니다.
      // 요청에 postFieldConfig가 실제로 들어온 경우에는 위에서 이미 엄격하게 검증합니다.
      postFieldConfig: parsePostFieldConfig(board.postFieldConfig ?? defaultPostFieldConfig),
      freezeAt: updatedFreezeAt ? updatedFreezeAt.toISOString() : null,
    };
    const requiresSync = [
      "discoveryScope", "visitorPermission", "loginRequired", "password",
      "allowComments", "allowReactions", "allowMemberPosting", "allowMemberFileUpload",
      "attachmentDownloadPolicy",
    ].some((key) => Object.hasOwn(parsed.data, key));
    publishBoardEvent(boardId, {
      type: "board.updated",
      entityId: boardId,
      actorId: user.id,
      payload: { boardPatch, ...(requiresSync ? { requiresSync: true } : {}) },
    });
    return Response.json({ board: boardPatch });
  } catch (error) {
    if (error instanceof PostFieldValidationError) return Response.json({ error: error.message, issues: error.issues }, { status: 400 });
    return apiError(error, "패드를 수정하지 못했습니다.");
  }
}

export async function DELETE(request: Request, { params }: { params: Promise<{ boardId: string }> }) {
  try {
    assertSameOrigin(request);
    const user = await requireActiveUser();
    const { boardId } = await params;
    const access = await getEffectiveBoardAccess(boardId, user);
    if (!access || !canArchiveBoard(user, access)) return Response.json({ error: "패드 소유자만 보관할 수 있습니다." }, { status: 403 });
    const globalOverride = !access.isOwner;
    await getPrisma().$transaction(async (transaction) => {
      await transaction.board.update({ where: { id: boardId }, data: { deletedAt: new Date() } });
      if (globalOverride) {
        await transaction.adminAuditLog.create({ data: createAuditLogData({ actorId: user.id, action: "GLOBAL_BOARD_ARCHIVED", entityType: "Board", entityId: boardId, reason: "전체관리자 패드 보관" }) });
      }
    });
    publishBoardEvent(boardId, { type: "board.updated", entityId: boardId, actorId: user.id });
    return Response.json({ ok: true, archived: true });
  } catch (error) {
    return apiError(error, "패드를 보관하지 못했습니다.");
  }
}
