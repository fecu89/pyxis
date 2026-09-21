import { requireActiveUser } from "@/lib/auth/authorization";
import { requireViewableForm } from "@/lib/forms/access";
import { getFormResponseDetail } from "@/lib/forms/summary";
import { apiError } from "@/lib/http";

// "개별" 탭이 한 응답을 펼쳐 볼 때 부릅니다. 목록(위 route.ts)이 매번 모든 응답의 answers를
// 실어 보내면 응답이 쌓일수록 첫 로딩이 느려지므로, 목록은 가벼운 요약만 주고 상세는 펼칠 때만.

export async function GET(_request: Request, { params }: { params: Promise<{ formId: string; responseId: string }> }) {
  try {
    const actor = await requireActiveUser();
    const { formId, responseId } = await params;
    await requireViewableForm(formId, actor);
    const detail = await getFormResponseDetail(formId, responseId);
    if (!detail) return Response.json({ error: "응답을 찾을 수 없습니다." }, { status: 404 });
    return Response.json({ response: detail });
  } catch (error) {
    return apiError(error, "응답을 불러오지 못했습니다.");
  }
}
