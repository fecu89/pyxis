import { requireActiveUser } from "@/lib/auth/authorization";
import { apiError, assertSameOrigin } from "@/lib/http";
import { requireManageableQuiz } from "@/lib/quiz/access";
import { QuizImageStorageLimitError, storeQuizImage } from "@/lib/quiz/image-store";
import { assertRateLimit } from "@/lib/security/rate-limit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * 문항 이미지·퀴즈 썸네일 업로드.
 *
 * 편집기는 아직 저장하지 않은 문항에도 사진을 올릴 수 있어서, 업로드 시점에 확정된 것은
 * quizId뿐입니다. 그래서 파일은 퀴즈 디렉터리에 모아 두고 주소만 돌려주며, 저장할 때
 * 참조되지 않은 파일을 퀴즈 저장 라우트가 정리합니다.
 */
export async function POST(request: Request, { params }: { params: Promise<{ quizId: string }> }) {
  try {
    assertSameOrigin(request);
    const actor = await requireActiveUser();
    // sharp 변환을 타므로 반복 업로드로 이미지 처리 슬롯을 점유하지 못하게 합니다(패드 배경과 같은 이유).
    // 문항마다 사진을 올리는 흐름이 정상이라 패드 배경보다는 넉넉하게 둡니다.
    assertRateLimit(request, {
      scope: "quiz-image-upload",
      userId: actor.id,
      windowMs: 10 * 60_000,
      maxAttempts: 60,
      message: "사진을 너무 자주 올렸습니다. 잠시 후 다시 시도해 주세요.",
    });
    const { quizId } = await params;
    await requireManageableQuiz(quizId, actor);

    const url = new URL(request.url);
    const stored = await storeQuizImage(request, quizId, { thumbnail: url.searchParams.get("kind") === "thumbnail" });
    return Response.json({ ok: true, ...stored });
  } catch (error) {
    if (error instanceof QuizImageStorageLimitError) {
      return Response.json({ error: error.message }, { status: error.status, headers: { "Cache-Control": "private, no-store" } });
    }
    return apiError(error, "사진을 올리지 못했습니다.");
  }
}
