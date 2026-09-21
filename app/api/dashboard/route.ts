import { Prisma } from "@/generated/prisma/client";
import { canReadEffectiveBoard, requireActiveUser } from "@/lib/auth/authorization";
import { hasVerifiedBoardPassword } from "@/lib/board/board-password";
import { getBoardAccess } from "@/lib/board/permissions";
import { dashboardFolderPatchSchema, dashboardFolderSchema, normalizeFolderName } from "@/lib/board-reuse/validators";
import { apiError, assertSameOrigin } from "@/lib/http";
import { getPrisma } from "@/lib/prisma";

function conflictError(error: unknown) {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002";
}

export async function POST(request: Request) {
  try {
    assertSameOrigin(request);
    const user = await requireActiveUser();
    const parsed = dashboardFolderSchema.safeParse(await request.json());
    if (!parsed.success) return Response.json({ error: "폴더 이름은 1~60자로 입력해 주세요." }, { status: 400 });
    const normalized = normalizeFolderName(parsed.data.name);
    const last = await getPrisma().dashboardFolder.findFirst({
      where: { userId: user.id },
      orderBy: { position: "desc" },
      select: { position: true },
    });
    const folder = await getPrisma().dashboardFolder.create({
      data: { userId: user.id, ...normalized, position: (last?.position ?? -1024) + 1024 },
      select: { id: true, name: true, position: true },
    });
    return Response.json({ folder: { ...folder, boardIds: [] } }, { status: 201 });
  } catch (error) {
    if (conflictError(error)) return Response.json({ error: "같은 이름의 폴더가 이미 있습니다." }, { status: 409 });
    return apiError(error, "폴더를 만들지 못했습니다.");
  }
}

export async function PATCH(request: Request) {
  try {
    assertSameOrigin(request);
    const user = await requireActiveUser();
    const parsed = dashboardFolderPatchSchema.safeParse(await request.json());
    if (!parsed.success) return Response.json({ error: "폴더 요청을 확인해 주세요." }, { status: 400 });
    const folder = await getPrisma().dashboardFolder.findFirst({
      where: { id: parsed.data.folderId, userId: user.id },
      select: { id: true },
    });
    if (!folder) return Response.json({ error: "폴더를 찾을 수 없습니다." }, { status: 404 });

    if (parsed.data.action === "rename") {
      const normalized = normalizeFolderName(parsed.data.name);
      const updated = await getPrisma().dashboardFolder.update({
        where: { id: folder.id },
        data: normalized,
        select: { id: true, name: true, position: true, boards: { select: { boardId: true }, orderBy: [{ position: "asc" }, { createdAt: "asc" }] } },
      });
      return Response.json({ folder: { id: updated.id, name: updated.name, position: updated.position, boardIds: updated.boards.map((item) => item.boardId) } });
    }

    const access = await getBoardAccess(parsed.data.boardId, user.id);
    if (!access || !canReadEffectiveBoard(user, access)) return Response.json({ error: "폴더에 넣을 패드에 접근할 수 없습니다." }, { status: 403 });
    if (access.role === null && access.board.passwordHash && !await hasVerifiedBoardPassword(parsed.data.boardId, access.board.passwordHash)) {
      return Response.json({ error: "패드 비밀번호를 확인한 뒤 폴더에 추가해 주세요." }, { status: 403 });
    }
    if (parsed.data.included) {
      const last = await getPrisma().dashboardFolderBoard.findFirst({
        where: { folderId: folder.id },
        orderBy: { position: "desc" },
        select: { position: true },
      });
      await getPrisma().dashboardFolderBoard.upsert({
        where: { folderId_boardId: { folderId: folder.id, boardId: parsed.data.boardId } },
        create: { folderId: folder.id, boardId: parsed.data.boardId, position: (last?.position ?? -1024) + 1024 },
        update: {},
      });
    } else {
      await getPrisma().dashboardFolderBoard.deleteMany({ where: { folderId: folder.id, boardId: parsed.data.boardId } });
    }
    return Response.json({ folderId: folder.id, boardId: parsed.data.boardId, included: parsed.data.included });
  } catch (error) {
    if (conflictError(error)) return Response.json({ error: "같은 이름의 폴더가 이미 있습니다." }, { status: 409 });
    return apiError(error, "폴더를 수정하지 못했습니다.");
  }
}

export async function DELETE(request: Request) {
  try {
    assertSameOrigin(request);
    const user = await requireActiveUser();
    const folderId = new URL(request.url).searchParams.get("folderId");
    if (!folderId || folderId.length > 100) return Response.json({ error: "폴더를 확인해 주세요." }, { status: 400 });
    const deleted = await getPrisma().dashboardFolder.deleteMany({ where: { id: folderId, userId: user.id } });
    if (!deleted.count) return Response.json({ error: "폴더를 찾을 수 없습니다." }, { status: 404 });
    return Response.json({ deleted: true });
  } catch (error) {
    return apiError(error, "폴더를 삭제하지 못했습니다.");
  }
}
