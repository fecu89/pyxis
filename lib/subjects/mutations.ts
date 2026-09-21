import "server-only";

import { AuthorizationError } from "@/lib/auth/authorization";
import type { CurrentUser } from "@/lib/auth/current-user";
import { getPrisma } from "@/lib/prisma";
import { canAssignStudentsToCourses, courseScopeSchoolId, eligibleCourseStudentWhere } from "@/lib/subjects/scope";

/**
 * 교과목 구성 변경은 전부 **델타(추가/제거)** 입니다.
 *
 * 예전에는 PATCH가 `studentIds` 전체 배열을 받아 `deleteMany({ notIn: studentIds })`로
 * 통째로 교체했습니다. 그 방식은 **클라이언트가 전체 명단을 들고 있어야만** 안전해서,
 * 페이지네이션을 붙이는 순간 화면에 없는 학생이 지워집니다. 게다가 배열 상한이 500이라
 * 500명을 넘는 교과목은 이름 하나 못 바꾸는 상태가 됐습니다(zod가 요청을 통째로 거부).
 *
 * 델타로 바꾸면 한 번에 보내는 양이 화면에서 고른 만큼으로 줄고, 동시에 두 교사가 서로
 * 다른 학생을 넣어도 마지막 저장이 앞의 것을 지우지 않습니다.
 */

const MAX_DELTA = 500;

export async function requireOwnedSubject(subjectId: string, actor: CurrentUser) {
  if (!canAssignStudentsToCourses(actor)) throw new AuthorizationError("교과목을 관리할 권한이 없습니다.");
  const subject = await getPrisma().subject.findUnique({ where: { id: subjectId } });
  if (!subject || subject.ownerId !== actor.id) throw new AuthorizationError("교과목을 관리할 권한이 없습니다.");
  return subject;
}

function assertDeltaSize(ids: string[], label: string) {
  if (ids.length > MAX_DELTA) {
    throw new AuthorizationError(`한 번에 바꿀 수 있는 ${label}은 ${MAX_DELTA}개까지입니다. 나눠서 저장해 주세요.`);
  }
}

/** 개별 학생 배정을 더하고 뺍니다. 학급 연결로 들어온 학생은 여기서 뺄 수 없습니다. */
export async function applyStudentDelta(
  subjectId: string,
  actor: CurrentUser,
  { add = [], remove = [] }: { add?: string[]; remove?: string[] },
) {
  if (!canAssignStudentsToCourses(actor)) throw new AuthorizationError("학생을 교과목에 배정할 권한이 없습니다.");
  const addIds = [...new Set(add)];
  const removeIds = [...new Set(remove)];
  assertDeltaSize(addIds, "학생");
  assertDeltaSize(removeIds, "학생");
  const prisma = getPrisma();

  if (addIds.length) {
    // 추가 대상이 전부 내가 다룰 수 있는 활성 학생인지 다시 확인합니다. 클라이언트가 보낸
    // ID는 신뢰하지 않습니다 — 다른 학교 학생 ID를 넣어도 여기서 걸립니다.
    const allowed = await prisma.user.count({
      where: { id: { in: addIds }, role: "STUDENT", status: "ACTIVE", ...eligibleCourseStudentWhere(actor) },
    });
    if (allowed !== addIds.length) throw new AuthorizationError("배정할 수 없는 학생이 포함되어 있습니다.");
  }

  await prisma.$transaction(async (tx) => {
    if (removeIds.length) {
      await tx.subjectStudent.deleteMany({ where: { subjectId, studentId: { in: removeIds } } });
    }
    if (addIds.length) {
      await tx.subjectStudent.createMany({
        data: addIds.map((studentId) => ({ subjectId, studentId, assignedById: actor.id })),
        skipDuplicates: true,
      });
    }
  });
}

/** 학급 연결을 더하고 뺍니다. 연결이라 이후 반 명단 변경이 자동으로 따라옵니다. */
export async function applyGroupDelta(
  subjectId: string,
  actor: CurrentUser,
  { add = [], remove = [] }: { add?: string[]; remove?: string[] },
) {
  if (!canAssignStudentsToCourses(actor)) throw new AuthorizationError("학급을 교과목에 연결할 권한이 없습니다.");
  const addIds = [...new Set(add)];
  const removeIds = [...new Set(remove)];
  assertDeltaSize(addIds, "학급");
  assertDeltaSize(removeIds, "학급");
  const prisma = getPrisma();

  if (addIds.length) {
    const schoolId = courseScopeSchoolId(actor);
    const allowed = await prisma.schoolGroup.count({
      where: { id: { in: addIds }, type: "CLASS", ...(schoolId === null ? {} : { schoolId }) },
    });
    if (allowed !== addIds.length) throw new AuthorizationError("연결할 수 없는 학급이 포함되어 있습니다.");
  }

  await prisma.$transaction(async (tx) => {
    if (removeIds.length) {
      await tx.subjectSchoolGroup.deleteMany({ where: { subjectId, schoolGroupId: { in: removeIds } } });
    }
    if (addIds.length) {
      await tx.subjectSchoolGroup.createMany({
        data: addIds.map((schoolGroupId) => ({ subjectId, schoolGroupId, assignedById: actor.id })),
        skipDuplicates: true,
      });
    }
  });
}

/**
 * 학급 명단을 **그 순간 그대로 개별 배정으로 복사**합니다. 연결과 달리 이후 반 변경을
 * 따라가지 않아서, 학기 중 반이 개편돼도 이 교과목 명단은 고정됩니다. 여러 반을 체크해서
 * 한 번에 넘기는 화면(roster-panel.tsx)이 있어 배열을 받습니다.
 */
export async function expandGroupsIntoStudents(subjectId: string, actor: CurrentUser, schoolGroupIds: string[]) {
  if (!canAssignStudentsToCourses(actor)) throw new AuthorizationError("학생을 교과목에 배정할 권한이 없습니다.");
  const ids = [...new Set(schoolGroupIds)];
  if (!ids.length) return { added: 0 };
  assertDeltaSize(ids, "학급");
  const prisma = getPrisma();
  const schoolId = courseScopeSchoolId(actor);
  const allowed = await prisma.schoolGroup.count({
    where: { id: { in: ids }, type: "CLASS", ...(schoolId === null ? {} : { schoolId }) },
  });
  if (allowed !== ids.length) throw new AuthorizationError("연결할 수 없는 학급이 포함되어 있습니다.");

  const students = await prisma.user.findMany({
    where: { schoolGroupId: { in: ids }, role: "STUDENT", status: "ACTIVE" },
    select: { id: true },
  });
  if (!students.length) return { added: 0 };

  const result = await prisma.subjectStudent.createMany({
    data: students.map(({ id }) => ({ subjectId, studentId: id, assignedById: actor.id })),
    skipDuplicates: true,
  });
  return { added: result.count };
}

/** 퀴즈·패드를 교과목에 붙이고 뗍니다. 소유자만, 그리고 자기 소유 자원만. */
export async function applyResourceDelta(
  subjectId: string,
  actor: CurrentUser,
  kind: "quiz" | "board" | "form",
  { add = [], remove = [] }: { add?: string[]; remove?: string[] },
) {
  const addIds = [...new Set(add)];
  const removeIds = [...new Set(remove)];
  const label = kind === "quiz" ? "퀴즈" : kind === "form" ? "설문" : "패드";
  assertDeltaSize(addIds, label);
  assertDeltaSize(removeIds, label);
  const prisma = getPrisma();
  const model = kind === "quiz" ? prisma.quiz : kind === "form" ? prisma.form : prisma.board;

  if (addIds.length) {
    const allowed = await (model as typeof prisma.quiz).count({
      where: { id: { in: addIds }, ownerId: actor.id, deletedAt: null },
    });
    if (allowed !== addIds.length) {
      throw new AuthorizationError(`관리할 수 없는 ${label}가 포함되어 있습니다.`);
    }
  }

  await prisma.$transaction(async (tx) => {
    const target = kind === "quiz" ? tx.quiz : kind === "form" ? tx.form : tx.board;
    if (removeIds.length) {
      // 떼는 건 "이 교과목에 붙어 있는 것"만 건드립니다. 다른 교과목 소속을 실수로
      // 미분류로 만들지 않기 위해서입니다.
      await (target as typeof tx.quiz).updateMany({
        where: { id: { in: removeIds }, ownerId: actor.id, subjectId },
        data: { subjectId: null },
      });
    }
    if (addIds.length) {
      await (target as typeof tx.quiz).updateMany({
        where: { id: { in: addIds }, ownerId: actor.id },
        data: { subjectId },
      });
    }
  });
}
