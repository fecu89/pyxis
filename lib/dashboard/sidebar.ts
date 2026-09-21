import "server-only";

import type { Prisma } from "@/generated/prisma/client";
import type { CurrentUser } from "@/lib/auth/current-user";
import { getRecentBoardVisits, getRecentFormVisits, getRecentQuizVisits, readableVisitedBoardWhere } from "@/lib/dashboard/visits";
import { getPrisma } from "@/lib/prisma";
import { href } from "@/lib/routes";

/** 패드 사이드바에 필요한 작은 읽기 모델. 패드 홈 카드·템플릿·접근 요청은 읽지 않습니다. */
export async function getPadSidebarData(user: CurrentUser) {
  const readableBoardWhere = readableVisitedBoardWhere(user);
  const prisma = getPrisma();
  const [folders, visits] = await Promise.all([
    prisma.dashboardFolder.findMany({
      where: { userId: user.id },
      orderBy: [{ position: "asc" }, { createdAt: "asc" }],
      select: {
        id: true,
        name: true,
        boards: {
          where: { board: readableBoardWhere },
          select: { boardId: true },
        },
      },
    }),
    getRecentBoardVisits(user, 6),
  ]);

  return {
    folders: folders.map((folder) => ({
      id: folder.id,
      name: folder.name,
      boardCount: folder.boards.length,
      href: href("folder", { folderId: folder.id }),
    })),
    recentBoards: visits.map((board) => ({
      id: board.id,
      slug: board.slug,
      title: board.title,
      href: href("board", { slug: board.slug }),
    })),
  };
}

/** 대시보드 사이드바용 교과목 목록. 카드 개수와 학생 명단은 본문만 필요하므로 읽지 않습니다. */
export async function getCourseSidebarData(user: CurrentUser) {
  const where: Prisma.SubjectWhereInput = {
    OR: [
      { ownerId: user.id },
      { students: { some: { studentId: user.id } } },
      { schoolGroups: { some: { schoolGroup: { users: { some: { id: user.id } } } } } },
    ],
  };
  const prisma = getPrisma();
  const [courses, totalCount] = await Promise.all([
    prisma.subject.findMany({
      where,
      orderBy: { name: "asc" },
      take: 100,
      select: { id: true, name: true },
    }),
    prisma.subject.count({ where }),
  ]);

  return {
    totalCount,
    courses: courses.map((course) => ({
      id: course.id,
      name: course.name,
      href: href("courseDetail", { subjectId: course.id }),
    })),
  };
}

/** 퀴즈 사이드바의 최근 항목. 콘텐츠 수정일이 아니라 현재 사용자의 실제 방문 시각 순입니다. */
export async function getQuizSidebarData(user: CurrentUser) {
  const quizzes = await getRecentQuizVisits(user, 6);
  return {
    items: quizzes.map((quiz) => ({
      id: quiz.id,
      title: quiz.title,
      href: href("quizDetail", { quizId: quiz.id }),
    })),
  };
}

/** 설문 사이드바도 현재 사용자의 실제 방문 시각 순으로만 정렬합니다. */
export async function getFormSidebarData(user: CurrentUser) {
  const forms = await getRecentFormVisits(user, 6);
  return {
    items: forms.map((form) => ({
      id: form.id,
      title: form.title,
      href: href("formDetail", { formId: form.id }),
    })),
  };
}
