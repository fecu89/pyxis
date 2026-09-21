import { randomUUID } from "node:crypto";
import { canCreateBoard, requireActiveUser } from "@/lib/auth/authorization";
import { boardMemberCandidateScope } from "@/lib/board/member-candidates";
import { assertCanOwnAnotherBoard, BoardOwnershipLimitError } from "@/lib/board/ownership-limit";
import { createBoardSchema, normalizeBoardAccessSettings } from "@/lib/board/validators";
import { inviteSubjectRosterToBoard } from "@/lib/board/subject-invite";
import { apiError, assertSameOrigin } from "@/lib/http";
import { cleanSubjectName, normalizeSubjectName } from "@/lib/quiz/subjects";
import { createActivity } from "@/lib/activity/ensure";
import { getPrisma } from "@/lib/prisma";

function makeSlug(title: string) {
  const base = title.toLowerCase().replace(/[^a-z0-9가-힣]+/g, "-").replace(/^-|-$/g, "").slice(0, 36) || "board";
  return `${base}-${randomUUID().slice(0, 6)}`;
}

class BoardCreateSelectionError extends Error {}

export async function POST(request: Request) {
  try {
    assertSameOrigin(request);
    const user = await requireActiveUser();
    if (!canCreateBoard(user)) return Response.json({ error: "패드를 만들 권한이 없습니다." }, { status: 403 });
    const parsed = createBoardSchema.safeParse(await request.json());
    if (!parsed.success) return Response.json({ error: "패드 정보를 확인해 주세요." }, { status: 400 });
    const normalized = normalizeBoardAccessSettings(parsed.data);
    const { subjectName, memberIds, ...input } = normalized;
    const cleanSubject = cleanSubjectName(subjectName);
    const board = await getPrisma().$transaction(async (tx) => {
      await assertCanOwnAnotherBoard(tx, user);
      // 교과목은 이름으로 받습니다(quiz 생성과 동일). 이미 있으면 연결, 없으면 내 소유로
      // 생성 — 항상 본인 교과목만 만져지므로 다른 사용자 교과목 연결 검사는 필요 없습니다.
      let subjectId: string | null = null;
      if (cleanSubject) {
        const nameNormalized = normalizeSubjectName(cleanSubject);
        subjectId = (await tx.subject.upsert({
          where: { ownerId_nameNormalized: { ownerId: user.id, nameNormalized } },
          update: {},
          create: { ownerId: user.id, name: cleanSubject, nameNormalized },
          select: { id: true },
        })).id;
      }
      if (memberIds.includes(user.id)) throw new BoardCreateSelectionError("패드 소유자는 초대 목록에 넣을 수 없습니다.");
      if (memberIds.length) {
        const scope = boardMemberCandidateScope(user);
        if (!scope.where) throw new BoardCreateSelectionError(scope.note);
        const eligible = await tx.user.findMany({
          where: { ...scope.where, id: { in: memberIds }, status: "ACTIVE" },
          select: { id: true },
        });
        if (eligible.length !== memberIds.length) throw new BoardCreateSelectionError("초대할 수 없는 구성원이 포함되어 있습니다.");
      }
      const activityId = await createActivity(tx, { type: "PAD_BOARD", ownerId: user.id, title: parsed.data.title });
      return tx.board.create({
        data: {
          ...input,
          activityId,
          subjectId,
          description: input.description || null,
          ownerId: user.id,
          slug: makeSlug(parsed.data.title),
          members: {
            create: [
              { userId: user.id, role: "OWNER" },
              ...memberIds.map((userId) => ({ userId, role: "MEMBER" as const })),
            ],
          },
          follows: { create: [user.id, ...memberIds].map((userId) => ({ userId })) },
        },
        select: { id: true, slug: true, subjectId: true },
      });
    });
    // 교과목을 골라 만든 패드는 그 순간의 교과목 명단을 한 번에 멤버로 초대합니다(1회성 —
    // 이후 명단이 바뀌어도 자동으로 반영되지 않습니다).
    if (board.subjectId) await inviteSubjectRosterToBoard(board.id, board.subjectId, user);
    return Response.json({ board: { id: board.id, slug: board.slug } }, { status: 201 });
  } catch (error) {
    if (error instanceof BoardCreateSelectionError) {
      return Response.json({ error: error.message }, { status: 400 });
    }
    if (error instanceof BoardOwnershipLimitError) {
      return Response.json({ error: error.message }, { status: error.status });
    }
    return apiError(error, "패드를 만들지 못했습니다.");
  }
}
