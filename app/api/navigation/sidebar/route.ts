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
    if (section === "form" && user.role === "STUDENT") {
      return Response.json({ error: "설문 사이드바를 볼 권한이 없습니다." }, { status: 403 });
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
