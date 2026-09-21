import "server-only";

import { AuthorizationError } from "@/lib/auth/authorization";
import type { CurrentUser } from "@/lib/auth/current-user";
import { getPrisma } from "@/lib/prisma";
import { enrolledSubjectWhere } from "@/lib/subjects/scope";

/** 교과목 바로가기의 읽기/POST 경계. 기존 PIN·QR 공유 참여 정책은 바꾸지 않습니다. */
export async function assertCourseLiveAccess(session: {
  mode: string; status: string; hostId: string;
  quiz: { subjectId: string | null; isPublished: boolean; deletedAt: Date | null };
}, subjectId: string, actor: CurrentUser | null) {
  if (!actor || actor.role !== "STUDENT" || actor.status !== "ACTIVE"
    || session.mode !== "LIVE" || !["LOBBY", "IN_PROGRESS"].includes(session.status)
    || session.quiz.deletedAt || !session.quiz.isPublished || session.quiz.subjectId !== subjectId) {
    throw new AuthorizationError("참여할 수 있는 교과목 라이브가 아닙니다.");
  }
  const allowed = await getPrisma().subject.count({
    where: { id: subjectId, ownerId: session.hostId, ...enrolledSubjectWhere(actor.id) },
  });
  if (!allowed) throw new AuthorizationError("이 교과목의 수강생만 참여할 수 있습니다.");
}
