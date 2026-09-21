import { requireActiveUser } from "@/lib/auth/authorization";
import { getCourseSidebarData, getFormSidebarData, getPadSidebarData, getQuizSidebarData } from "@/lib/dashboard/sidebar";
import { apiError } from "@/lib/http";

export async function GET(request: Request) {
  try {
    const user = await requireActiveUser();
    const section = new URL(request.url).searchParams.get("section") ?? "pad";
    if (section !== "pad" && section !== "dashboard" && section !== "quiz" && section !== "form") {
      return Response.json({ error: "사이드바 영역을 확인해 주세요." }, { status: 400 });
    }
    if ((section === "form" || section === "quiz") && user.role === "STUDENT") {
      // 원본 편집/응답 관리로 이어지는 최근 목록을 학생에게 내려보내지 않습니다.
      return Response.json({ items: [] }, { headers: { "Cache-Control": "private, no-store" } });
    }
    const data = section === "dashboard" ? await getCourseSidebarData(user)
      : section === "quiz" ? await getQuizSidebarData(user)
      : section === "form" ? await getFormSidebarData(user)
      : await getPadSidebarData(user);
    return Response.json(data, {
      headers: { "Cache-Control": "private, no-store" },
    });
  } catch (error) {
    return apiError(error, "사이드바를 불러오지 못했습니다.");
  }
}
