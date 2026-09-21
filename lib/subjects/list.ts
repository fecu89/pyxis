import "server-only";

import { getPrisma } from "@/lib/prisma";

/**
 * 내가 소유한 교과목 목록입니다. `/api/subjects` GET과 새 퀴즈 화면이 같은 조회를 씁니다.
 *
 * 예전에는 새 퀴즈 화면이 페이지 전체를 `"use client"`로 두고 `useEffect`에서 이 API를 불렀는데,
 * 그러면 첫 HTML에는 교과목 칸이 비어 있다가 왕복 한 번 뒤에 채워집니다. 서버 컴포넌트가
 * 직접 읽으면 첫 화면부터 들어 있습니다 — 그 목적으로 쿼리를 여기로 뺐습니다.
 */
export async function listOwnedSubjects(ownerId: string) {
  return getPrisma().subject.findMany({
    where: { ownerId },
    orderBy: { name: "asc" },
    select: {
      id: true,
      name: true,
      _count: {
        select: {
          quizzes: { where: { deletedAt: null } },
          boards: { where: { deletedAt: null } },
          students: true,
        },
      },
    },
  });
}
