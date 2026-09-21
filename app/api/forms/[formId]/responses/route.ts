import { requireActiveUser } from "@/lib/auth/authorization";
import { requireViewableForm } from "@/lib/forms/access";
import { buildFormSummary, listFormResponses } from "@/lib/forms/summary";
import { apiError } from "@/lib/http";

// 응답 집계 + 개별 응답 목록(페이지네이션)입니다. 편집은 못 해도 VIEWER 공유를 받은 사람도
// 볼 수는 있어야 하므로 requireOwnedForm이 아니라 requireViewableForm을 씁니다.

export async function GET(request: Request, { params }: { params: Promise<{ formId: string }> }) {
  try {
    const actor = await requireActiveUser();
    const { formId } = await params;
    await requireViewableForm(formId, actor);

    const pageParam = Number(new URL(request.url).searchParams.get("page") ?? "1");
    const page = Number.isInteger(pageParam) && pageParam > 0 ? pageParam : 1;

    const [summary, responses] = await Promise.all([
      buildFormSummary(formId),
      listFormResponses(formId, page),
    ]);
    return Response.json({ summary, responses });
  } catch (error) {
    return apiError(error, "응답을 불러오지 못했습니다.");
  }
}
