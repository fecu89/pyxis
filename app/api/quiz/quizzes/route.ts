import { z } from "zod";
import { canViewAllQuizzes, requireActiveUser } from "@/lib/auth/authorization";
import { apiError, assertSameOrigin } from "@/lib/http";
import { readJsonWithLimit } from "@/lib/http-json";
import { getPrisma } from "@/lib/prisma";
import { requireQuizCreationCapacity } from "@/lib/quiz/creation-limit";
import { cleanSubjectName, normalizeSubjectName } from "@/lib/quiz/subjects";

const listQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(50),
});

export async function GET(request: Request) {
  try {
    const actor = await requireActiveUser();
    const parsed = listQuerySchema.safeParse(Object.fromEntries(new URL(request.url).searchParams));
    if (!parsed.success) return Response.json({ error: "페이지 조건을 확인해 주세요." }, { status: 400 });
    const { page, pageSize } = parsed.data;
    const where = {
      deletedAt: null,
      ...(canViewAllQuizzes(actor) ? {} : { OR: [{ ownerId: actor.id }, { shares: { some: { userId: actor.id } } }] }),
    };
    const [quizzes, total] = await Promise.all([
      getPrisma().quiz.findMany({
        where,
        orderBy: { createdAt: "desc" },
        skip: (page - 1) * pageSize,
        take: pageSize,
        select: {
          id: true,
          title: true,
          description: true,
          isPublished: true,
          requiresLogin: true,
          subject: { select: { id: true, name: true } },
          createdAt: true,
          _count: { select: { questions: true } },
        },
      }),
      getPrisma().quiz.count({ where }),
    ]);
    return Response.json({ quizzes, pagination: { page, pageSize, total, totalPages: Math.max(1, Math.ceil(total / pageSize)) } }, {
      headers: { "Cache-Control": "private, no-store" },
    });
  } catch (error) {
    return apiError(error, "퀴즈 목록을 불러오지 못했습니다.");
  }
}

const createSchema = z.object({
  title: z.string().trim().min(1).max(120),
  description: z.string().trim().max(2000).optional(),
  requiresLogin: z.boolean().optional(),
  isSearchable: z.boolean().optional(),
  subjectName: z.string().trim().max(60).optional(),
});
const CREATE_QUIZ_BODY_MAX_BYTES = 16 * 1024;

export async function POST(request: Request) {
  try {
    assertSameOrigin(request);
    const actor = await requireActiveUser();
    await requireQuizCreationCapacity(actor);
    const { title, description, requiresLogin, isSearchable, subjectName } = createSchema.parse(await readJsonWithLimit(request, CREATE_QUIZ_BODY_MAX_BYTES));
    const cleanSubject = cleanSubjectName(subjectName);

    const quiz = await getPrisma().quiz.create({
      data: {
        owner: { connect: { id: actor.id } },
        title,
        description,
        requiresLogin: requiresLogin ?? true,
        isSearchable: isSearchable ?? false,
        ...(cleanSubject ? {
          subject: {
            connectOrCreate: {
              where: { ownerId_nameNormalized: { ownerId: actor.id, nameNormalized: normalizeSubjectName(cleanSubject) } },
              create: { ownerId: actor.id, name: cleanSubject, nameNormalized: normalizeSubjectName(cleanSubject) },
            },
          },
        } : {}),
      },
      select: { id: true, title: true, description: true, isPublished: true, requiresLogin: true, isSearchable: true, createdAt: true, subject: { select: { id: true, name: true } } },
    });
    return Response.json({ quiz }, { status: 201 });
  } catch (error) {
    return apiError(error, "퀴즈를 생성하지 못했습니다.");
  }
}
