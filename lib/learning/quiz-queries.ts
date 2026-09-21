import "server-only";

import type { Prisma } from "@/generated/prisma/client";
import type { CurrentUser } from "@/lib/auth/current-user";
import { getPrisma } from "@/lib/prisma";
import { enrolledSubjectWhere } from "@/lib/subjects/scope";
import type { LearningItem, LearningPage } from "./types";

const quizSelect = { title: true, description: true, subject: { select: { id: true, name: true } } } as const;
const sessionSelect = { id: true, status: true, pinCode: true, quiz: { select: quizSelect } } as const;
const assignmentSelect = {
  id: true, quiz: { select: quizSelect },
  session: { select: { id: true, status: true, openAt: true, dueAt: true, allowLateSubmission: true,
    participants: { select: { status: true, currentQuestionIndex: true } },
  } },
} as const;
type Assignment = Prisma.QuizAssignmentGetPayload<{ select: typeof assignmentSelect }>;
type Source = { count: () => Promise<number>; load: (skip: number, take: number) => Promise<LearningItem[]> };

function assignmentItem({ id, quiz, session }: Assignment, now: Date): LearningItem {
  const participant = session.participants[0];
  const completed = participant?.status === "COMPLETED";
  const started = participant?.status === "IN_PROGRESS" || (participant?.currentQuestionIndex ?? 0) > 0;
  const upcoming = Boolean(session.openAt && session.openAt > now);
  const ended = session.status === "FINISHED" || session.status === "CANCELLED" || Boolean(session.dueAt && session.dueAt < now && !session.allowLateSubmission);
  return { id: `assignment:${id}`, mode: "ASYNC", title: quiz.title, description: quiz.description, subjectName: quiz.subject?.name ?? null,
    status: completed ? "완료" : ended ? "마감" : upcoming ? "시작 전" : started ? "진행 중" : "새 과제",
    action: completed ? "결과 보기" : started ? "이어서 풀기" : "과제 풀기",
    href: completed ? `/quiz/activities/${session.id}/report` : ended || upcoming ? null : `/p/${session.id}`,
  };
}

/** 라이브·과제는 서로 다른 응시입니다. 우선순위 묶음별 count/skip/take로 전체 로드 없이 페이지를 합칩니다. */
export async function getQuizLearningPage(user: CurrentUser, options: { subjectId?: string; page: number; pageSize: number }): Promise<LearningPage> {
  const prisma = getPrisma();
  const { subjectId, pageSize } = options;
  const now = new Date();
  const courses = await prisma.subject.findMany({
    where: { ...enrolledSubjectWhere(user.id), ...(subjectId ? { id: subjectId } : {}) },
    select: { id: true, ownerId: true },
  });
  // 공유받은 다른 교사가 연 방까지 원 소유자의 수업에 노출하지 않습니다.
  const courseSessions = courses.map(course => ({ hostId: course.ownerId, quiz: { subjectId: course.id } }));
  const activeLive: Prisma.QuizSessionWhereInput = {
    mode: "LIVE", status: { in: ["LOBBY", "IN_PROGRESS"] }, pinCode: { not: null },
    quiz: { deletedAt: null, isPublished: true }, OR: courseSessions,
    participants: { none: { userId: user.id, status: "KICKED" } },
  };
  const assignmentBase: Prisma.QuizAssignmentWhereInput = {
    studentId: user.id, quiz: { deletedAt: null, ...(subjectId ? { subjectId } : {}) },
    session: { mode: "ASYNC", participants: { some: { userId: user.id, status: { not: "KICKED" } } } },
  };
  const pendingSession: Prisma.QuizSessionWhereInput = {
    status: { in: ["LOBBY", "IN_PROGRESS"] },
    OR: [{ dueAt: null }, { dueAt: { gte: now } }, { allowLateSubmission: true }],
    participants: { some: { userId: user.id, status: { notIn: ["KICKED", "COMPLETED"] } } },
  };
  const waiting: Prisma.QuizWhereInput = {
    deletedAt: null, isPublished: true,
    OR: courses.map(course => ({ subjectId: course.id,
      sessions: { none: { hostId: course.ownerId, mode: "LIVE", status: { in: ["LOBBY", "IN_PROGRESS"] }, pinCode: { not: null } } },
    })),
    // 이미 개인 과제가 있는 퀴즈는 과제 카드가 있으므로 별도 대기 카드를 중복 표시하지 않습니다.
    assignments: { none: { studentId: user.id } },
  };
  const finishedLive: Prisma.QuizSessionWhereInput = {
    mode: "LIVE", status: "FINISHED", requiresLogin: true,
    quiz: { deletedAt: null, ...(subjectId ? { subjectId } : {}) },
    participants: { some: { userId: user.id, status: { not: "KICKED" } } },
  };
  const orderBy = [{ createdAt: "desc" }, { id: "desc" }] as const;
  const assignmentSource = (where: Prisma.QuizAssignmentWhereInput): Source => ({
    count: () => prisma.quizAssignment.count({ where }),
    load: async (skip, take) => (await prisma.quizAssignment.findMany({ where, skip, take, orderBy: [...orderBy],
      select: { ...assignmentSelect, session: { select: { ...assignmentSelect.session.select,
        participants: { where: { userId: user.id }, select: assignmentSelect.session.select.participants.select },
      } } },
    })).map(row => assignmentItem(row, now)),
  });
  const sources: Source[] = [
    {
      count: () => prisma.quizSession.count({ where: activeLive }),
      load: async (skip, take) => (await prisma.quizSession.findMany({ where: activeLive, skip, take, orderBy: [...orderBy], select: sessionSelect })).map(row => ({
        id: `live:${row.id}`, mode: "LIVE", title: row.quiz.title, description: row.quiz.description,
        subjectName: row.quiz.subject?.name ?? null, status: row.status === "LOBBY" ? "입장 가능" : "라이브 진행 중", action: "라이브 참여",
        href: `/j/${row.pinCode}?subjectId=${encodeURIComponent(row.quiz.subject!.id)}`,
      })),
    },
    assignmentSource({ ...assignmentBase, AND: [{ session: pendingSession }] }),
    {
      count: () => prisma.quiz.count({ where: waiting }),
      load: async (skip, take) => (await prisma.quiz.findMany({ where: waiting, skip, take, orderBy: [{ updatedAt: "desc" }, { id: "desc" }], select: { id: true, ...quizSelect } })).map(row => ({
        id: `waiting:${row.id}`, mode: "LIVE", title: row.title, description: row.description, subjectName: row.subject?.name ?? null,
        status: "수업 대기", action: "수업 대기", href: null,
      })),
    },
    {
      count: () => prisma.quizSession.count({ where: finishedLive }),
      load: async (skip, take) => (await prisma.quizSession.findMany({ where: finishedLive, skip, take, orderBy: [...orderBy], select: sessionSelect })).map(row => ({
        id: `live:${row.id}`, mode: "LIVE", title: row.quiz.title, description: row.quiz.description, subjectName: row.quiz.subject?.name ?? null,
        status: "수업 종료", action: "내 결과 보기", href: `/quiz/activities/${row.id}/report`,
      })),
    },
    assignmentSource({ ...assignmentBase, NOT: { session: pendingSession } }),
  ];
  const counts = await Promise.all(sources.map(source => source.count()));
  const total = counts.reduce((sum, count) => sum + count, 0);
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const page = Math.min(options.page, totalPages);
  let skip = (page - 1) * pageSize;
  const items: LearningItem[] = [];
  for (let index = 0; index < sources.length && items.length < pageSize; index++) {
    if (skip >= counts[index]) { skip -= counts[index]; continue; }
    items.push(...await sources[index].load(skip, Math.min(pageSize - items.length, counts[index] - skip)));
    skip = 0;
  }
  return { kind: "quiz", items, total, page, pageSize, totalPages };
}
