import { z } from "zod";
import { requireActiveUser } from "@/lib/auth/authorization";
import { apiError, assertSameOrigin } from "@/lib/http";
import { readJsonWithLimit } from "@/lib/http-json";
import { applyGroupDelta, applyStudentDelta, expandGroupsIntoStudents, requireOwnedSubject } from "@/lib/subjects/mutations";
import { getCourseRosterData, getCourseGroupLinks, getCourseRoster, getLinkableSchoolGroups, ROSTER_PAGE_SIZE } from "@/lib/subjects/roster";

// 명단은 개별 배정과 학급 연결의 합집합이라 한 번에 다 내려보내지 않습니다. 400명 규모에서
// 전체를 보내면 그만큼 복호화가 돌고 클라이언트가 통째로 들고 있어야 하기 때문입니다.
export async function GET(request: Request, { params }: { params: Promise<{ subjectId: string }> }) {
  try {
    const actor = await requireActiveUser();
    const { subjectId } = await params;
    const url = new URL(request.url);

    // 수강생에게는 학습 목록만 제공합니다. 소유 기록만 있는 학생도 명단을 읽지 못합니다.
    await requireOwnedSubject(subjectId, actor);

    const page = Number(url.searchParams.get("page") ?? "1") || 1;
    const data = page === 1
      ? await getCourseRosterData(subjectId, actor, true)
      : await Promise.all([
          getCourseRoster(subjectId, { page, pageSize: ROSTER_PAGE_SIZE }),
          getCourseGroupLinks(subjectId),
          getLinkableSchoolGroups(subjectId, actor),
        ]).then(([roster, groups, linkableGroups]) => ({ ...roster, groups, linkableGroups }));
    return Response.json(data, { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) {
    return apiError(error, "명단을 불러오지 못했습니다.");
  }
}

const deltaSchema = z.object({
  students: z.object({
    add: z.array(z.string().min(1)).optional(),
    remove: z.array(z.string().min(1)).optional(),
  }).optional(),
  groups: z.object({
    add: z.array(z.string().min(1)).optional(),
    remove: z.array(z.string().min(1)).optional(),
  }).optional(),
  /** 학급 명단을 그 순간 그대로 개별 배정으로 복사합니다(이후 반 변경을 따라가지 않음). 여러 반을 한 번에 넘길 수 있습니다. */
  expandGroupIds: z.array(z.string().min(1)).optional(),
}).refine((value) => value.students || value.groups || value.expandGroupIds?.length, "바꿀 내용을 입력해 주세요.");
const ROSTER_DELTA_BODY_MAX_BYTES = 256 * 1024;

// 전체 교체가 아니라 델타입니다. 이유는 lib/subjects/mutations.ts 주석 참고 — 전체 교체는
// 클라이언트가 명단 전부를 들고 있어야만 안전해서 페이지네이션과 양립할 수 없습니다.
export async function POST(request: Request, { params }: { params: Promise<{ subjectId: string }> }) {
  try {
    assertSameOrigin(request);
    const actor = await requireActiveUser();
    const { subjectId } = await params;
    await requireOwnedSubject(subjectId, actor);
    const input = deltaSchema.parse(await readJsonWithLimit(request, ROSTER_DELTA_BODY_MAX_BYTES));

    let expanded = 0;
    if (input.expandGroupIds?.length) {
      expanded = (await expandGroupsIntoStudents(subjectId, actor, input.expandGroupIds)).added;
    }
    if (input.groups) await applyGroupDelta(subjectId, actor, input.groups);
    if (input.students) await applyStudentDelta(subjectId, actor, input.students);

    const [roster, groups, linkable] = await Promise.all([
      getCourseRoster(subjectId, { page: 1, pageSize: ROSTER_PAGE_SIZE }),
      getCourseGroupLinks(subjectId),
      getLinkableSchoolGroups(subjectId, actor),
    ]);
    return Response.json({ ...roster, groups, linkableGroups: linkable, expanded });
  } catch (error) {
    return apiError(error, "명단을 저장하지 못했습니다.");
  }
}
