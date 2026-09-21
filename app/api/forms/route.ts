import { z } from "zod";
import { createActivity } from "@/lib/activity/ensure";
import { requireRole } from "@/lib/auth/authorization";
import { createFormSlug } from "@/lib/forms/access";
import { FORM_TITLE_MAX } from "@/lib/forms/field-schema";
import { apiError, assertSameOrigin } from "@/lib/http";
import { getPrisma } from "@/lib/prisma";

// 목록은 `/forms` 서버 컴포넌트가 세션을 확인한 뒤 DB에서 직접 페이지 단위로 읽습니다.
// 이 라우트는 새 설문 생성만 담당합니다.

const createSchema = z.object({
  title: z.string().trim().min(1, "제목을 입력해 주세요.").max(FORM_TITLE_MAX),
  description: z.string().trim().max(3000).nullable().optional(),
  requiresLogin: z.boolean().optional(),
});

export async function POST(request: Request) {
  try {
    assertSameOrigin(request);
    // 설문은 응답에 개인정보가 담기므로 학생은 만들 수 없습니다.
    const actor = await requireRole(["SUPER_ADMIN", "ADMIN", "TEACHER"]);
    const body = createSchema.parse(await request.json());

    const form = await getPrisma().$transaction(async (tx) => {
      // 활동 레코드를 같은 트랜잭션에서 만들어야 둘 중 하나만 남는 상태가 생기지 않습니다.
      const activityId = await createActivity(tx, { type: "FORM", ownerId: actor.id, title: body.title });
      return tx.form.create({
        data: {
          ownerId: actor.id,
          activityId,
          slug: createFormSlug(),
          title: body.title,
          description: body.description ?? null,
          requiresLogin: body.requiresLogin ?? true,
          // 빈 설문으로 시작하면 편집기가 그릴 것이 없어, 단답형 질문 하나를 놓아 둡니다.
          fields: { create: [{ type: "SHORT_TEXT", title: "", position: 0 }] },
        },
        select: { id: true, title: true, slug: true },
      });
    });

    return Response.json({ form }, { status: 201 });
  } catch (error) {
    return apiError(error, "설문을 만들지 못했습니다.");
  }
}
