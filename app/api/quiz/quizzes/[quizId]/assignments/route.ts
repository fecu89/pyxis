import { z } from "zod";
import { AuthorizationError, requireRole } from "@/lib/auth/authorization";
import { apiError, assertSameOrigin } from "@/lib/http";
import { createActivity } from "@/lib/activity/ensure";
import { getPrisma } from "@/lib/prisma";
import { requireManageableQuiz } from "@/lib/quiz/access";
import { ASSIGN_PAGE_SIZE, assignableStudentWhere, getAssignableClassGroups, getAssignableStudentCandidates } from "@/lib/quiz/assign-candidates";
// quiz의 학생 실명(displayNameEncrypted)과 시스템 아이디(username)는 병합 스키마에 없습니다.
// pad는 표시 이름을 nameEncrypted 하나로, 로그인 아이디를 loginIdentifierEncrypted로 다룹니다.
import { decryptUserLoginIdentifier, toPublicAuthorDTO } from "@/lib/users/repository";

const assignmentSchema = z.object({
  studentIds: z.array(z.string().min(1)).min(1).max(100),
});

/**
 * 할당 대상 학생 선택. 예전에는 교사가 관리할 수 있는 학생을 최대 500명까지 통째로 내려보내
 * 매 요청마다 수백 명을 복호화했습니다 — `lib/subjects/roster.ts`의 교과목 명단 후보 패턴을
 * 그대로 따라 검색·페이지 단위 조회(`lib/quiz/assign-candidates.ts`)로 옮깁니다.
 *
 *   ?view=classes           필터용 학급 목록만
 *   ?q=&classId=&page=      검색·학급·페이지로 좁힌 학생 후보(기본)
 *
 * 권한 판정(`assignableStudentWhere`)은 POST의 검증과 같은 함수를 씁니다.
 */
export async function GET(request: Request, { params }: { params: Promise<{ quizId: string }> }) {
  try {
    const actor = await requireRole(["TEACHER", "ADMIN", "SUPER_ADMIN"]);
    const { quizId } = await params;
    await requireManageableQuiz(quizId, actor);

    const url = new URL(request.url);
    const headers = { "Cache-Control": "private, no-store" };
    if (url.searchParams.get("view") === "classes") {
      return Response.json({ classes: await getAssignableClassGroups(actor) }, { headers });
    }

    const q = url.searchParams.get("q") ?? "";
    const classId = url.searchParams.get("classId") || undefined;
    const page = Number(url.searchParams.get("page") ?? "1") || 1;
    const result = await getAssignableStudentCandidates(actor, { search: q, schoolGroupId: classId, page, pageSize: ASSIGN_PAGE_SIZE });
    return Response.json(result, { headers });
  } catch (error) {
    return apiError(error, "학생 목록을 불러오지 못했습니다.");
  }
}

export async function POST(request: Request, { params }: { params: Promise<{ quizId: string }> }) {
  try {
    assertSameOrigin(request);
    const actor = await requireRole(["TEACHER", "ADMIN", "SUPER_ADMIN"]);
    const { quizId } = await params;
    const quiz = await requireManageableQuiz(quizId, actor);
    if (!quiz.isPublished) throw new Error("발행된 퀴즈만 학생에게 할당할 수 있습니다.");
    const body = assignmentSchema.parse(await request.json());
    const studentIds = [...new Set(body.studentIds)];
    const students = await getPrisma().user.findMany({
      where: { id: { in: studentIds }, role: "STUDENT", status: "ACTIVE", ...assignableStudentWhere(actor) },
      select: { id: true, loginIdentifierEncrypted: true, nameEncrypted: true, imageEncrypted: true },
    });
    if (students.length !== studentIds.length) throw new AuthorizationError("관리할 수 없는 학생이 포함되어 있습니다.");

    // 학생 한 명당 INSERT 3번을 순차로 돌리면 100명 할당이 300 왕복이 되어 인터랙티브 트랜잭션
    // 기본 타임아웃(5초)에 걸립니다. 테이블별로 한 번씩만 묶어서 넣습니다.
    const result = await getPrisma().$transaction(async (tx) => {
      const activityId = await createActivity(tx, { type: "QUIZ_SESSION", ownerId: actor.id, title: quiz.title });
      const session = await tx.quizSession.create({
        data: { quizId, hostId: actor.id, activityId, mode: "ASYNC", requiresLogin: true },
        select: { id: true },
      });
      await tx.sessionParticipant.createMany({
        data: students.map((student) => ({
          sessionId: session.id,
          userId: student.id,
          nickname: toPublicAuthorDTO(student).name || decryptUserLoginIdentifier(student) || "학생",
        })),
      });
      const assignments = await tx.quizAssignment.createManyAndReturn({
        data: students.map((student) => ({ quizId, sessionId: session.id, studentId: student.id, assignedById: actor.id })),
        select: { id: true, studentId: true },
      });
      await tx.notification.createMany({
        data: assignments.map((assignment) => ({
          userId: assignment.studentId,
          actorId: actor.id,
          type: "QUIZ_ASSIGNED" as const,
          quizId,
          assignmentId: assignment.id,
        })),
      });
      return { sessionId: session.id, assignments };
    });
    return Response.json({ ...result, assignedCount: result.assignments.length }, { status: 201 });
  } catch (error) {
    return apiError(error, "퀴즈를 할당하지 못했습니다.");
  }
}
