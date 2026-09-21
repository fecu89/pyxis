import { z } from "zod";
import { canManageAnySession, requireRole } from "@/lib/auth/authorization";
import { requireManageableQuiz } from "@/lib/quiz/access";
import { generateUniquePin } from "@/lib/quiz/session-pin";
import { apiError, assertSameOrigin } from "@/lib/http";
import { readJsonWithLimit } from "@/lib/http-json";
import { createActivity } from "@/lib/activity/ensure";
import { getPrisma } from "@/lib/prisma";

const listQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(50),
});

export async function GET(request: Request) {
  try {
    const actor = await requireRole(["TEACHER", "ADMIN", "SUPER_ADMIN"]);
    const parsed = listQuerySchema.safeParse(Object.fromEntries(new URL(request.url).searchParams));
    if (!parsed.success) return Response.json({ error: "페이지 조건을 확인해 주세요." }, { status: 400 });
    const { page, pageSize } = parsed.data;
    // 남의 세션까지 보는 건 MANAGE_ANY_SESSION을 가진 관리자뿐입니다(SUPER_ADMIN 포함).
    const where = canManageAnySession(actor) ? {} : { hostId: actor.id };
    const [sessions, total] = await Promise.all([
      getPrisma().quizSession.findMany({
        where,
        orderBy: { createdAt: "desc" },
        skip: (page - 1) * pageSize,
        take: pageSize,
        select: {
          id: true,
          mode: true,
          status: true,
          livePhase: true,
          pinCode: true,
          createdAt: true,
          quiz: { select: { id: true, title: true } },
          _count: { select: { participants: true } },
        },
      }),
      getPrisma().quizSession.count({ where }),
    ]);
    return Response.json({ sessions, pagination: { page, pageSize, total, totalPages: Math.max(1, Math.ceil(total / pageSize)) } }, {
      headers: { "Cache-Control": "private, no-store" },
    });
  } catch (error) {
    return apiError(error, "세션 목록을 불러오지 못했습니다.");
  }
}

const createSchema = z.object({
  quizId: z.string().min(1),
  mode: z.enum(["LIVE", "ASYNC"]),
  openAt: z.string().datetime().optional(),
  dueAt: z.string().datetime().optional(),
  allowLateSubmission: z.boolean().optional(),
}).superRefine((data, context) => {
  if (data.openAt && data.dueAt && new Date(data.openAt) >= new Date(data.dueAt)) {
    context.addIssue({ code: "custom", path: ["dueAt"], message: "마감 시각은 공개 시각보다 뒤여야 합니다." });
  }
  if (data.mode === "LIVE" && (data.openAt || data.dueAt || data.allowLateSubmission !== undefined)) {
    context.addIssue({ code: "custom", path: ["mode"], message: "공개·마감 설정은 자율 풀이에서만 사용할 수 있습니다." });
  }
});
const CREATE_SESSION_BODY_MAX_BYTES = 16 * 1024;

export async function POST(request: Request) {
  try {
    assertSameOrigin(request);
    const actor = await requireRole(["TEACHER", "ADMIN", "SUPER_ADMIN"]);
    const body = createSchema.parse(await readJsonWithLimit(request, CREATE_SESSION_BODY_MAX_BYTES));
    const quiz = await requireManageableQuiz(body.quizId, actor);
    if (!quiz.isPublished) throw new Error("발행된 퀴즈만 세션을 만들 수 있습니다.");

    const pinCode = await generateUniquePin();
    // 세션과 활동 레코드는 반드시 한 트랜잭션에서 만듭니다. 둘 중 하나만 남으면 /report의
    // 통합 목록에서 이 세션이 조용히 빠집니다.
    const session = await getPrisma().$transaction(async (tx) => {
      const activityId = await createActivity(tx, {
        type: "QUIZ_SESSION",
        ownerId: actor.id,
        title: quiz.title,
      });
      return tx.quizSession.create({
        data: {
          quizId: body.quizId,
          hostId: actor.id,
          activityId,
          mode: body.mode,
          pinCode,
          livePhase: body.mode === "LIVE" ? "LOBBY" : null,
          openAt: body.openAt ? new Date(body.openAt) : null,
          dueAt: body.dueAt ? new Date(body.dueAt) : null,
          allowLateSubmission: body.allowLateSubmission ?? false,
          requiresLogin: quiz.requiresLogin,
        },
        select: { id: true, mode: true, status: true, pinCode: true, createdAt: true },
      });
    });
    return Response.json({ session }, { status: 201 });
  } catch (error) {
    return apiError(error, "세션을 생성하지 못했습니다.");
  }
}
