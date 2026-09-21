import "server-only";

import type { Prisma } from "@/generated/prisma/client";
import { hasSystemPermission } from "@/lib/auth/permissions";
import type { CurrentUser } from "@/lib/auth/current-user";
import { getPrisma } from "@/lib/prisma";

// `/report`의 조회 계층입니다. 퀴즈 세션·패드 보드·설문을 각자 조회해 응용 코드에서 머지하지
// 않고 `Activity` 한 테이블만 읽습니다 — 그래야 정렬·페이지네이션이 자연스럽게 동작합니다.

export const REPORT_PAGE_SIZE = 30;

export type ReportActivityType = "QUIZ_SESSION" | "PAD_BOARD" | "FORM";

export type ActivityRow = {
  id: string;
  type: ReportActivityType;
  title: string;
  ownerName: string | null;
  schoolGroupName: string | null;
  createdAt: string;
  endedAt: string | null;
  /** 상세 화면으로 보낼 경로. 활동 종류에 따라 퀴즈 리포트나 패드 리포트로 갈립니다. */
  href: string | null;
  participantCount: number;
};

/**
 * 볼 수 있는 활동의 범위를 정합니다.
 * - 전체·콘텐츠 권한 관리자: 전부
 * - 교사: 자기 학교
 * - 그 외: 자기가 연 것만
 *
 * 학생 개인의 참여 기록은 이 목록이 아니라 `/report/students/[id]`가 다룹니다.
 */
function scopeFor(user: CurrentUser) {
  if (user.role === "SUPER_ADMIN"
    || hasSystemPermission(user, "VIEW_ALL_BOARDS")
    || hasSystemPermission(user, "VIEW_ALL_QUIZZES")) {
    return {};
  }
  if (user.role === "TEACHER" && user.school) return { schoolId: user.school.id };
  return { ownerId: user.id };
}

function availableActivityWhere(type?: ReportActivityType): Prisma.ActivityWhereInput {
  if (type === "QUIZ_SESSION") return { type, quizSession: { isNot: null } };
  if (type === "PAD_BOARD") return { type, board: { is: { deletedAt: null } } };
  if (type === "FORM") return { type, form: { is: { deletedAt: null } } };

  // Activity는 삭제 여부를 복제하지 않습니다. 따라서 연결된 도메인 행까지 확인하지 않으면
  // soft-delete된 패드가 대시보드와 리포트 목록에 계속 남습니다. 관계가 끊긴 고아 활동도
  // 링크를 만들 수 없으므로 같은 지점에서 제외합니다.
  return {
    OR: [
      { type: "QUIZ_SESSION", quizSession: { isNot: null } },
      { type: "PAD_BOARD", board: { is: { deletedAt: null } } },
      { type: "FORM", form: { is: { deletedAt: null } } },
    ],
  };
}

export async function getActivityPage(user: CurrentUser, options: { page?: number; type?: ReportActivityType } = {}) {
  const requestedPage = Math.max(1, options.page ?? 1);
  const where: Prisma.ActivityWhereInput = {
    AND: [scopeFor(user), availableActivityWhere(options.type)],
  };
  const prisma = getPrisma();

  const total = await prisma.activity.count({ where });
  const page = Math.min(requestedPage, Math.max(1, Math.ceil(total / REPORT_PAGE_SIZE)));
  const rows = await prisma.activity.findMany({
      where,
      orderBy: { createdAt: "desc" },
      skip: (page - 1) * REPORT_PAGE_SIZE,
      take: REPORT_PAGE_SIZE,
      select: {
        id: true, type: true, title: true, createdAt: true, endedAt: true,
        owner: { select: { id: true, nameEncrypted: true, imageEncrypted: true } },
        schoolGroup: { select: { name: true } },
        quizSession: { select: { id: true, _count: { select: { participants: true } } } },
        board: { select: { slug: true, _count: { select: { posts: true } } } },
        // 응답 수는 Form.responseCount(비정규화 카운터)가 아니라 여기서 셉니다. 카운터는 정원
        // 판정용이라 제출 중 실패하면 실제 행 수와 잠깐 어긋날 수 있는데, 리포트는 정확한 쪽이
        // 맞습니다. 30행짜리 페이지라 비용도 문제가 되지 않습니다.
        form: { select: { id: true, _count: { select: { responses: true } } } },
      },
    });

  // 이름은 암호문이라 DB에서 정렬·필터할 수 없어 조회 후 복호화합니다.
  const { toPublicAuthorDTO } = await import("@/lib/users/repository");

  const items: ActivityRow[] = rows.map((row) => ({
    id: row.id,
    type: row.type,
    title: row.title,
    ownerName: row.owner ? toPublicAuthorDTO(row.owner).name : null,
    schoolGroupName: row.schoolGroup?.name ?? null,
    createdAt: row.createdAt.toISOString(),
    endedAt: row.endedAt?.toISOString() ?? null,
    // 상세 화면은 각 도메인이 이미 갖고 있는 것을 그대로 씁니다. /report 아래에 같은 화면을
    // 한 벌 더 만들면 권한 판정과 표시 규칙이 두 곳으로 갈라집니다.
    href: hrefFor(row),
    // 퀴즈는 참여자 수, 패드는 글 수, 설문은 응답 수 — 셋 다 "얼마나 활발했는가"를 한 숫자로
    // 보여 줍니다.
    participantCount:
      row.quizSession?._count.participants ?? row.board?._count.posts ?? row.form?._count.responses ?? 0,
  }));

  return { items, total, page, pageSize: REPORT_PAGE_SIZE };
}

type LinkableRow = {
  type: ReportActivityType;
  quizSession: { id: string } | null;
  board: { slug: string } | null;
  form: { id: string } | null;
};

/**
 * 목록에서 상세로 가는 경로. 대상이 지워져 활동만 남은 행은 null이라 화면이 링크로 감싸지
 * 않습니다.
 */
function hrefFor(row: LinkableRow): string | null {
  if (row.type === "QUIZ_SESSION") return row.quizSession ? `/quiz/activities/${row.quizSession.id}/report` : null;
  if (row.type === "PAD_BOARD") return row.board ? `/b/${row.board.slug}` : null;
  if (row.type === "FORM") return row.form ? `/forms/${row.form.id}/responses` : null;
  return null;
}
