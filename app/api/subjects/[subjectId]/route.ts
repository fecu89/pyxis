import { z } from "zod";
import { requireActiveUser } from "@/lib/auth/authorization";
import { apiError, assertSameOrigin } from "@/lib/http";
import { getPrisma } from "@/lib/prisma";
import { cleanSubjectName, normalizeSubjectName } from "@/lib/quiz/subjects";
import { getCourseSummary } from "@/lib/subjects/course-dashboard";
import { requireOwnedSubject } from "@/lib/subjects/mutations";

// 이 라우트는 이제 **이름만** 바꿉니다.
//
// 예전에는 여기서 `studentIds`/`quizIds`/`boardIds` 전체 배열을 받아 통째로 교체했습니다
// (`deleteMany({ notIn: … })`). 그 방식은 클라이언트가 명단 전부를 들고 있어야만 안전해서
// 페이지네이션과 양립할 수 없었고, 배열 상한이 500이라 **500명을 넘는 교과목은 이름조차
// 못 바꾸는** 상태였습니다(zod가 요청 전체를 거부).
//
// 구성 변경은 델타 라우트로 나눴습니다:
//   · 학생·학급  → POST /api/subjects/[subjectId]/roster
//   · 퀴즈·패드  → POST /api/subjects/[subjectId]/resources
const updateSchema = z.object({
  name: z.string().trim().min(1).max(60),
});

export async function PATCH(request: Request, { params }: { params: Promise<{ subjectId: string }> }) {
  try {
    assertSameOrigin(request);
    const actor = await requireActiveUser();
    const { subjectId } = await params;
    await requireOwnedSubject(subjectId, actor.id);
    const input = updateSchema.parse(await request.json());

    const name = cleanSubjectName(input.name);
    await getPrisma().subject.update({
      where: { id: subjectId },
      data: { name, nameNormalized: normalizeSubjectName(name) },
    });
    return Response.json({ subject: await getCourseSummary(subjectId, actor.id) });
  } catch (error) {
    return apiError(error, "교과목을 수정하지 못했습니다.");
  }
}

export async function DELETE(request: Request, { params }: { params: Promise<{ subjectId: string }> }) {
  try {
    assertSameOrigin(request);
    const actor = await requireActiveUser();
    const { subjectId } = await params;
    await requireOwnedSubject(subjectId, actor.id);
    // 퀴즈·패드의 subjectId는 외래키 정책(SetNull)으로 미분류가 되고, 명부와 학급 연결만
    // 함께 사라집니다(Cascade). 학생 계정에는 영향이 없습니다.
    await getPrisma().subject.delete({ where: { id: subjectId } });
    return Response.json({ ok: true });
  } catch (error) {
    return apiError(error, "교과목을 삭제하지 못했습니다.");
  }
}
