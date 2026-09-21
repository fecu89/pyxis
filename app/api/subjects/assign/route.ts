import { z } from "zod";
import { AuthorizationError, requireActiveUser } from "@/lib/auth/authorization";
import { inviteSubjectRosterToBoard } from "@/lib/board/subject-invite";
import { apiError, assertSameOrigin } from "@/lib/http";
import { getPrisma } from "@/lib/prisma";

/**
 * 퀴즈·패드 **한 개**의 교과목을 바꿉니다. 목록 화면(내 퀴즈·내 패드)에서 항목마다 교과목을
 * 바로 고를 수 있게 하려고 둡니다 — 교과목 화면으로 들어가지 않고도 분류할 수 있어야 한다는
 * 요구에서 나왔습니다.
 *
 * 교과목 화면 쪽의 델타 라우트(`/api/subjects/[subjectId]/resources`)와 방향이 반대입니다.
 * 저쪽은 "이 교과목에 무엇을 넣을까", 이쪽은 "이 퀴즈를 어느 교과목에 둘까"입니다. 서로 다른
 * 화면이 각자 자연스러운 축으로 부를 수 있게 둘 다 둡니다.
 *
 * 퀴즈 PATCH에도 교과목 필드가 있지만 그쪽은 **이름 문자열**을 받아 없으면 새로 만듭니다
 * (생성 폼용). 목록에서 고르는 건 이미 있는 교과목이라 ID로 다루는 이 라우트를 씁니다.
 */
const assignSchema = z.object({
  kind: z.enum(["quiz", "board"]),
  id: z.string().min(1),
  /** null이면 미분류로 되돌립니다. */
  subjectId: z.string().min(1).nullable(),
});

export async function POST(request: Request) {
  try {
    assertSameOrigin(request);
    const actor = await requireActiveUser();
    const { kind, id, subjectId } = assignSchema.parse(await request.json());
    const prisma = getPrisma();

    if (subjectId) {
      const subject = await prisma.subject.findUnique({ where: { id: subjectId }, select: { ownerId: true } });
      if (!subject || subject.ownerId !== actor.id) throw new AuthorizationError("교과목을 관리할 권한이 없습니다.");
    }

    // 자기 소유 자원만 옮길 수 있습니다. updateMany + ownerId 조건이라 남의 것을 지정해도
    // 0건이 갱신되고, 아래에서 그걸 권한 오류로 돌려줍니다.
    const target = kind === "quiz" ? prisma.quiz : prisma.board;
    const { count } = await (target as typeof prisma.quiz).updateMany({
      where: { id, ownerId: actor.id, deletedAt: null },
      data: { subjectId },
    });
    if (count === 0) throw new AuthorizationError(`관리할 수 없는 ${kind === "quiz" ? "퀴즈" : "패드"}입니다.`);

    // 패드를 교과목에 새로 연결했을 때만 그 순간의 교과목 명단을 한 번에 초대합니다(1회성).
    // 미분류로 되돌리는 경우(subjectId === null)나 퀴즈는 대상이 아닙니다.
    if (kind === "board" && subjectId) await inviteSubjectRosterToBoard(id, subjectId, actor);

    return Response.json({ ok: true, subjectId });
  } catch (error) {
    return apiError(error, "교과목을 지정하지 못했습니다.");
  }
}
