import { createReadStream } from "node:fs";
import { rename, stat, unlink } from "node:fs/promises";
import path from "node:path";
import { Readable } from "node:stream";
import sharp from "sharp";
import {
  canManageBoardSettings,
  canReadEffectiveBoard,
  getEffectiveBoardAccess,
  requireActiveUser,
} from "@/lib/auth/authorization";
import { getCurrentUser } from "@/lib/auth/current-user";
import { hasVerifiedBoardPassword } from "@/lib/board/board-password";
import { streamMultipartFile } from "@/lib/files/multipart";
import { getBoardBackgroundPath, getBoardUploadDirectory } from "@/lib/files/paths";
import { withImageProcessingSlot } from "@/lib/files/processing-queue";
import { getUploadPolicy, mb } from "@/lib/files/upload-policy";
import { validateUploadedFile } from "@/lib/files/validation";
import { apiError, assertSameOrigin } from "@/lib/http";
import { getPrisma } from "@/lib/prisma";
import { publishBoardEvent } from "@/lib/realtime/board-events";
import { assertRateLimit } from "@/lib/security/rate-limit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const ALLOWED_EXTENSIONS = new Set([".jpg", ".jpeg", ".png", ".webp"]);


function backgroundUrl(boardId: string) {
  return `/api/boards/${boardId}/background-image?v=${Date.now()}`;
}

export async function GET(_request: Request, { params }: { params: Promise<{ boardId: string }> }) {
  try {
    const { boardId } = await params;
    const currentUser = await getCurrentUser();
    const access = await getEffectiveBoardAccess(boardId, currentUser);
    if (!access || !canReadEffectiveBoard(currentUser, access)) {
      return new Response("이미지를 찾을 수 없습니다.", { status: 404 });
    }
    if (access.role === null && access.board.passwordHash && !await hasVerifiedBoardPassword(boardId, access.board.passwordHash)) {
      return new Response("이미지를 찾을 수 없습니다.", { status: 404 });
    }
    const board = await getPrisma().board.findUnique({
      where: { id: boardId },
      select: { backgroundImageUrl: true },
    });
    if (!board?.backgroundImageUrl) return new Response("이미지를 찾을 수 없습니다.", { status: 404 });

    const filePath = getBoardBackgroundPath(boardId);
    const fileStat = await stat(filePath).catch(() => null);
    if (!fileStat?.isFile()) return new Response("이미지를 찾을 수 없습니다.", { status: 404 });
    return new Response(Readable.toWeb(createReadStream(filePath)) as ReadableStream<Uint8Array>, {
      headers: {
        "Content-Type": "image/webp",
        "Content-Length": String(fileStat.size),
        "Content-Disposition": "inline; filename=\"background.webp\"",
        "Cache-Control": "private, max-age=3600",
        "X-Content-Type-Options": "nosniff",
        "Content-Security-Policy": "default-src 'none'; sandbox",
      },
    });
  } catch {
    return new Response("이미지를 찾을 수 없습니다.", { status: 404 });
  }
}

export async function POST(request: Request, { params }: { params: Promise<{ boardId: string }> }) {
  let incomingPath: string | null = null;
  let processingPath: string | null = null;
  try {
    assertSameOrigin(request);
    const user = await requireActiveUser();
    // 배경 이미지도 sharp 변환을 타므로 반복 업로드로 이미지 처리 슬롯을 점유하지 못하게 합니다.
    assertRateLimit(request, {
      scope: "board-background-upload",
      userId: user.id,
      windowMs: 10 * 60_000,
      maxAttempts: 20,
      message: "배경 이미지를 너무 자주 변경했습니다. 잠시 후 다시 시도해 주세요.",
    });
    const { boardId } = await params;
    const access = await getEffectiveBoardAccess(boardId, user);
    if (!access || !canManageBoardSettings(user, access)) {
      return Response.json({ error: "패드 배경을 바꿀 권한이 없습니다." }, { status: 403 });
    }

    const directory = getBoardUploadDirectory(boardId);
    // 배경 상한은 관리 페이지 → 정책 탭에서 정합니다(예전에는 이 파일과 클라이언트 컴포넌트에
    // 10MB가 따로 박혀 있어 한쪽만 바꾸면 화면과 서버 판정이 갈라졌습니다).
    const maxBackgroundBytes = mb((await getUploadPolicy()).maxBoardBackgroundMb);
    const uploaded = await streamMultipartFile(request, directory, maxBackgroundBytes);
    incomingPath = uploaded.temporaryPath;
    const extension = path.extname(uploaded.originalName).toLowerCase();
    if (!ALLOWED_EXTENSIONS.has(extension)) {
      throw new Error("JPG, PNG, WebP 이미지만 배경으로 올릴 수 있습니다.");
    }
    const validated = await validateUploadedFile(uploaded);
    if (!validated.isImage) throw new Error("이미지 파일만 배경으로 올릴 수 있습니다.");

    const finalPath = getBoardBackgroundPath(boardId);
    processingPath = `${finalPath}.uploading`;
    await withImageProcessingSlot(() =>
      sharp(incomingPath!, { failOn: "error", limitInputPixels: 40_000_000 })
        .rotate()
        .resize({ width: 1920, height: 1200, fit: "inside", withoutEnlargement: true })
        .webp({ quality: 82, effort: 4 })
        .toFile(processingPath!),
    );
    await rename(/* turbopackIgnore: true */ processingPath, finalPath);
    processingPath = null;
    await unlink(/* turbopackIgnore: true */ incomingPath);
    incomingPath = null;

    const imageUrl = backgroundUrl(boardId);
    await getPrisma().board.update({
      where: { id: boardId },
      data: { backgroundImageUrl: imageUrl },
    });
    publishBoardEvent(boardId, { type: "board.updated", entityId: boardId, actorId: user.id, payload: { boardPatch: { backgroundImageUrl: imageUrl } } });
    return Response.json({ ok: true, backgroundImageUrl: imageUrl });
  } catch (error) {
    if (incomingPath) await unlink(/* turbopackIgnore: true */ incomingPath).catch(() => undefined);
    if (processingPath) await unlink(/* turbopackIgnore: true */ processingPath).catch(() => undefined);
    return apiError(error, "패드 배경 이미지를 업로드하지 못했습니다.");
  }
}

export async function DELETE(request: Request, { params }: { params: Promise<{ boardId: string }> }) {
  try {
    assertSameOrigin(request);
    const user = await requireActiveUser();
    const { boardId } = await params;
    const access = await getEffectiveBoardAccess(boardId, user);
    if (!access || !canManageBoardSettings(user, access)) {
      return Response.json({ error: "패드 배경을 바꿀 권한이 없습니다." }, { status: 403 });
    }
    await getPrisma().board.update({ where: { id: boardId }, data: { backgroundImageUrl: null } });
    await unlink(/* turbopackIgnore: true */ getBoardBackgroundPath(boardId)).catch(() => undefined);
    publishBoardEvent(boardId, { type: "board.updated", entityId: boardId, actorId: user.id, payload: { boardPatch: { backgroundImageUrl: null } } });
    return Response.json({ ok: true, backgroundImageUrl: null });
  } catch (error) {
    return apiError(error, "패드 배경 이미지를 삭제하지 못했습니다.");
  }
}
