import { z } from "zod";
import { requireActiveUser } from "@/lib/auth/authorization";
import { apiError, assertSameOrigin } from "@/lib/http";
import { getPrisma } from "@/lib/prisma";
import { cleanSubjectName, normalizeSubjectName } from "@/lib/quiz/subjects";
import { listOwnedSubjects } from "@/lib/subjects/list";

const subjectSchema = z.object({ name: z.string().trim().min(1).max(60) });

export async function GET() {
  try {
    const actor = await requireActiveUser();
    // 새 퀴즈 화면(서버 컴포넌트)도 같은 조회를 쓰므로 lib으로 뺐습니다.
    return Response.json({ subjects: await listOwnedSubjects(actor.id) });
  } catch (error) {
    return apiError(error, "교과목을 불러오지 못했습니다.");
  }
}

export async function POST(request: Request) {
  try {
    assertSameOrigin(request);
    const actor = await requireActiveUser();
    const parsed = subjectSchema.parse(await request.json());
    const name = cleanSubjectName(parsed.name);
    const subject = await getPrisma().subject.upsert({
      where: { ownerId_nameNormalized: { ownerId: actor.id, nameNormalized: normalizeSubjectName(name) } },
      create: { ownerId: actor.id, name, nameNormalized: normalizeSubjectName(name) },
      update: { name },
      select: {
        id: true,
        name: true,
        _count: {
          select: {
            quizzes: { where: { deletedAt: null } },
            boards: { where: { deletedAt: null } },
            students: true,
          },
        },
      },
    });
    return Response.json({ subject }, { status: 201 });
  } catch (error) {
    return apiError(error, "교과목을 추가하지 못했습니다.");
  }
}
