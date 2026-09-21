import { z } from "zod";
import { AuthorizationError, requireActiveUser } from "@/lib/auth/authorization";
import { apiError, assertSameOrigin } from "@/lib/http";
import { getPrisma } from "@/lib/prisma";
import { requireOwnedQuiz } from "@/lib/quiz/access";
import { maskLoginIdentifier } from "@/lib/security/pii-crypto";
// quiz는 표시 이름(displayNameEncrypted)과 이메일(emailEncrypted)을 따로 두었지만, 병합
// 스키마는 이름을 nameEncrypted로, 카카오 이메일과 일반 아이디를 loginIdentifierEncrypted
// 하나로 다룹니다. 그래서 "연락처 마스킹"도 로그인 식별자 마스킹으로 바뀝니다.
import { decryptUserLoginIdentifier, toPublicAuthorDTO } from "@/lib/users/repository";
// 후보 범위(같은 학교, VIEW_USERS면 전체)와 POST 대상 검증의 판정은 설문 공유
// (`lib/forms/shares.ts`)와 같은 함수 하나로 공유합니다.
import { teacherShareCandidateScope } from "@/lib/users/share-scope";

const shareSchema = z.object({
  userId: z.string().min(1),
  permission: z.enum(["EDITOR", "VIEWER"]),
});

export async function GET(_request: Request, { params }: { params: Promise<{ quizId: string }> }) {
  try {
    const actor = await requireActiveUser();
    const { quizId } = await params;
    const quiz = await requireOwnedQuiz(quizId, actor);
    if (actor.role === "STUDENT") throw new AuthorizationError("학생 퀴즈는 다른 교사와 공유할 수 없습니다.");
    const [shares, candidates] = await Promise.all([
      getPrisma().quizShare.findMany({
        where: { quizId },
        orderBy: { createdAt: "asc" },
        select: {
          permission: true,
          user: { select: { id: true, nameEncrypted: true, imageEncrypted: true, loginIdentifierEncrypted: true } },
        },
      }),
      getPrisma().user.findMany({
        // 이미 공유된 대상(`shares`)은 이 범위와 무관하게 그대로 내려줍니다 — 학교 밖 교사와
        // 맺어 둔 기존 공유의 확인·해제가 끊기면 안 됩니다.
        where: { role: "TEACHER", status: "ACTIVE", id: { not: quiz.ownerId }, ...teacherShareCandidateScope(actor) },
        orderBy: [{ createdAt: "asc" }, { id: "asc" }],
        take: 300,
        select: { id: true, nameEncrypted: true, imageEncrypted: true, loginIdentifierEncrypted: true },
      }),
    ]);
    // 공유 상대를 정확히 골라야 하므로 이름은 원문, 연락처인 로그인 식별자는 마스킹해 보여 줍니다.
    const toTeacher = (user: { id: string; nameEncrypted: string | null; imageEncrypted: string | null; loginIdentifierEncrypted: string }) => ({
      id: user.id,
      name: toPublicAuthorDTO(user).name,
      maskedLoginIdentifier: maskLoginIdentifier(decryptUserLoginIdentifier(user)),
    });
    // 이름이 암호문이라 DB에서 정렬할 수 없어 복호화 후 정렬합니다(교사 수 규모에서 문제없음).
    const collator = new Intl.Collator("ko-KR");
    return Response.json({
      shares: shares.map((share) => ({ permission: share.permission, user: toTeacher(share.user) })),
      candidates: candidates
        .map(toTeacher)
        .sort((a, b) => collator.compare(a.name ?? "", b.name ?? "")),
    });
  } catch (error) {
    return apiError(error, "공유 정보를 불러오지 못했습니다.");
  }
}

export async function POST(request: Request, { params }: { params: Promise<{ quizId: string }> }) {
  try {
    assertSameOrigin(request);
    const actor = await requireActiveUser();
    const { quizId } = await params;
    const quiz = await requireOwnedQuiz(quizId, actor);
    if (actor.role === "STUDENT") throw new AuthorizationError("학생 퀴즈는 다른 교사와 공유할 수 없습니다.");
    const body = shareSchema.parse(await request.json());
    if (body.userId === quiz.ownerId) throw new Error("퀴즈 소유자에게는 이미 모든 권한이 있습니다.");
    // 이미 공유 행이 있는 대상은 scope와 무관하게 허용합니다 — 후보를 같은 학교로 축소하기
    // 이전에 맺어진 학교 밖 공유의 권한 변경(업서트)이 막히면 기존 관계를 관리할 수 없게 됩니다.
    const existing = await getPrisma().quizShare.findUnique({ where: { quizId_userId: { quizId, userId: body.userId } }, select: { userId: true } });
    // 범위 밖 대상도 존재하지 않는 대상과 같은 "찾을 수 없음"으로 응답합니다 — 다른 메시지를
    // 노출하면 범위 밖 계정의 존재 여부가 흘러 나갑니다.
    const target = await getPrisma().user.findFirst({
      where: { id: body.userId, role: "TEACHER", status: "ACTIVE", ...(existing ? {} : teacherShareCandidateScope(actor)) },
      select: { id: true },
    });
    if (!target) throw new Error("공유할 교사를 찾을 수 없습니다.");

    await getPrisma().$transaction(async (tx) => {
      await tx.quizShare.upsert({
        where: { quizId_userId: { quizId, userId: body.userId } },
        create: { quizId, userId: body.userId, permission: body.permission, grantedById: actor.id },
        update: { permission: body.permission, grantedById: actor.id },
      });
      await tx.notification.create({ data: { userId: body.userId, actorId: actor.id, type: "QUIZ_SHARED", quizId } });
    });
    return Response.json({ ok: true });
  } catch (error) {
    return apiError(error, "퀴즈를 공유하지 못했습니다.");
  }
}
