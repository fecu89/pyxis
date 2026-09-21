import { z } from "zod";
import { requireActiveUser } from "@/lib/auth/authorization";
import type { CurrentUser } from "@/lib/auth/current-user";
import { inviteSubjectRosterToBoard } from "@/lib/board/subject-invite";
import { apiError, assertSameOrigin } from "@/lib/http";
import { readJsonWithLimit } from "@/lib/http-json";
import { applyResourceDelta, requireOwnedSubject } from "@/lib/subjects/mutations";
import { getCourseSummary } from "@/lib/subjects/course-dashboard";

const deltaSchema = z.object({
  quizzes: z.object({
    add: z.array(z.string().min(1)).optional(),
    remove: z.array(z.string().min(1)).optional(),
  }).optional(),
  boards: z.object({
    add: z.array(z.string().min(1)).optional(),
    remove: z.array(z.string().min(1)).optional(),
  }).optional(),
  forms: z.object({
    add: z.array(z.string().min(1)).optional(),
    remove: z.array(z.string().min(1)).optional(),
  }).optional(),
}).refine((value) => value.quizzes || value.boards || value.forms, "바꿀 내용을 입력해 주세요.");
const RESOURCE_DELTA_BODY_MAX_BYTES = 256 * 1024;
const BOARD_INVITE_CONCURRENCY = 4;

async function inviteBoardRosters(boardIds: string[], subjectId: string, actor: CurrentUser) {
  const uniqueBoardIds = [...new Set(boardIds)];
  // 각 초대는 명단 조회와 트랜잭션을 포함합니다. 모두 직렬이면 큰 선택이 타임아웃에 가깝고,
  // 모두 병렬이면 DB pool을 독점하므로 작은 묶음 단위로만 병렬 처리합니다.
  for (let index = 0; index < uniqueBoardIds.length; index += BOARD_INVITE_CONCURRENCY) {
    await Promise.all(
      uniqueBoardIds
        .slice(index, index + BOARD_INVITE_CONCURRENCY)
        .map((boardId) => inviteSubjectRosterToBoard(boardId, subjectId, actor)),
    );
  }
}

// 퀴즈·패드 연결도 델타입니다. 전체 배열을 받던 예전 PATCH는 화면이 목록 전부를 들고 있어야
// 안전했는데, 소유 퀴즈가 수백 개면 그 전제가 성립하지 않습니다.
export async function POST(request: Request, { params }: { params: Promise<{ subjectId: string }> }) {
  try {
    assertSameOrigin(request);
    const actor = await requireActiveUser();
    const { subjectId } = await params;
    await requireOwnedSubject(subjectId, actor);
    const input = deltaSchema.parse(await readJsonWithLimit(request, RESOURCE_DELTA_BODY_MAX_BYTES));

    if (input.quizzes) await applyResourceDelta(subjectId, actor, "quiz", input.quizzes);
    if (input.forms) await applyResourceDelta(subjectId, actor, "form", input.forms);
    if (input.boards) {
      await applyResourceDelta(subjectId, actor, "board", input.boards);
      // 새로 연결한(add) 패드마다 그 순간의 교과목 명단을 한 번에 초대합니다(1회성). 이미
      // 연결돼 있던 패드를 다시 add해도 대상 학생이 전부 이미 멤버라 안전하게 0명 추가로 끝납니다.
      await inviteBoardRosters(input.boards.add ?? [], subjectId, actor);
    }

    return Response.json({ subject: await getCourseSummary(subjectId, actor.id) });
  } catch (error) {
    return apiError(error, "구성을 저장하지 못했습니다.");
  }
}
