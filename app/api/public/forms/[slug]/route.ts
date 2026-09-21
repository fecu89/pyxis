import { getCurrentUser } from "@/lib/auth/current-user";
import { loadPublicFormData } from "@/lib/forms/public-form-data";
import { apiError } from "@/lib/http";

// 공개 응답 화면(`/s/[slug]`)이 읽는 설문 정의입니다. 로그인 없이도 열려야 하므로 인증을
// 요구하지 않습니다 — `isOpenApiPath`가 `/api/public/*`의 인증 게이트를 건너뜁니다.
//
// 로그인 사용자도 **같은 라우트**를 씁니다. `getCurrentUser()`로 신원을 선택적으로만 읽고,
// requiresLogin 여부에 따른 접근 판정은 화면(`app/(play)/s/[slug]/page.tsx`)이 합니다 — 여기서
// 401을 던지면 "로그인하면 볼 수 있는 설문"과 "존재하지 않는 설문"을 구분할 수 없습니다.

export async function GET(request: Request, { params }: { params: Promise<{ slug: string }> }) {
  try {
    const { slug } = await params;
    const data = await loadPublicFormData({
      slug,
      actor: await getCurrentUser(),
      cookieHeader: request.headers.get("cookie"),
    });
    if (!data) return Response.json({ form: null }, { status: 404 });
    return Response.json(data);
  } catch (error) {
    return apiError(error, "설문을 불러오지 못했습니다.");
  }
}
