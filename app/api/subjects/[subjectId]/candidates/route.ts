import { requireActiveUser } from "@/lib/auth/authorization";
import { apiError } from "@/lib/http";
import { requireOwnedSubject } from "@/lib/subjects/mutations";
import { getCourseStudentCandidates, ROSTER_PAGE_SIZE } from "@/lib/subjects/roster";
import { getCourseBoardCandidates, getCourseQuizCandidates, getCourseFormCandidates, RESOURCE_PAGE_SIZE, type ResourceFilter } from "@/lib/subjects/resources";

const FILTERS = new Set<ResourceFilter>(["all", "linked", "unassigned"]);

/**
 * 교과목에 붙일 후보를 검색·페이지 단위로 읽습니다. 학생 400명·퀴즈 수백 개를 통째로
 * 내려보내던 것을 대신합니다.
 *
 *   ?type=student&q=&classId=&page=
 *   ?type=quiz|board&q=&filter=all|linked|unassigned&page=
 */
export async function GET(request: Request, { params }: { params: Promise<{ subjectId: string }> }) {
  try {
    const actor = await requireActiveUser();
    const { subjectId } = await params;
    // 후보 조회는 곧 "이 학교 학생이 누구인지" 조회라 소유자에게만 엽니다.
    await requireOwnedSubject(subjectId, actor);

    const url = new URL(request.url);
    const type = url.searchParams.get("type") ?? "student";
    const search = url.searchParams.get("q") ?? "";
    const page = Number(url.searchParams.get("page") ?? "1") || 1;
    const headers = { "Cache-Control": "private, no-store" };

    if (type === "student") {
      const result = await getCourseStudentCandidates(subjectId, actor, {
        search,
        schoolGroupId: url.searchParams.get("classId") || undefined,
        page,
        pageSize: ROSTER_PAGE_SIZE,
      });
      return Response.json(result, { headers });
    }

    if (type === "quiz" || type === "board" || type === "form") {
      const rawFilter = url.searchParams.get("filter") ?? "all";
      const filter: ResourceFilter = FILTERS.has(rawFilter as ResourceFilter) ? rawFilter as ResourceFilter : "all";
      const load = type === "quiz" ? getCourseQuizCandidates : type === "form" ? getCourseFormCandidates : getCourseBoardCandidates;
      return Response.json(await load(subjectId, actor.id, { search, page, pageSize: RESOURCE_PAGE_SIZE, filter }), { headers });
    }

    return Response.json({ error: "알 수 없는 후보 종류입니다." }, { status: 400 });
  } catch (error) {
    return apiError(error, "후보를 불러오지 못했습니다.");
  }
}
