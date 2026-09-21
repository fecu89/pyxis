import "../lib/load-env";
import assert from "node:assert/strict";
import { getPrisma } from "../lib/prisma";
import { createPadActivity } from "./fixtures";

// padupgrade.md 4.1 완료 조건: "31번째 이후 게시물이 누락되지 않는 회귀 테스트 추가".
// 지금까지는 수동 curl 검증만 했던 부분을 자동화한다. GET /api/sections/[sectionId]/posts는
// "server-only" 없는 평범한 Route Handler이므로 verify-admin-http.ts처럼 실행 중인 dev 서버에
// 직접 HTTP로 검증한다(별도 --conditions 플래그 필요 없음).
// 127.0.0.1이 아니라 localhost입니다. `.env.development`의 APP_ORIGINS가 localhost:3001만
// 허용하고 lib/http.ts의 assertSameOrigin은 호스트를 문자열로 비교하므로, 127.0.0.1로 보내면
// 쓰기 요청이 전부 403("허용되지 않은 요청 출처입니다")으로 막힙니다.
const baseUrl = process.env.VERIFY_BASE_URL || "http://localhost:3001";
const POST_PAGE_SIZE = 30;
const TOTAL_POSTS = 35;

async function main() {
  const prisma = getPrisma();
  const owner = await prisma.user.findFirst({ where: { role: "TEACHER", status: "ACTIVE" }, select: { id: true } });
  assert.ok(owner, "테스트용 활성 교사 계정이 필요합니다(npm run db:seed).");

  const board = await prisma.board.create({
    data: {
      slug: `verify-pagination-${Date.now()}`,
      title: "[검증용] 페이지네이션 임시 보드",
      ownerId: owner.id,
      activityId: await createPadActivity(prisma, owner.id, "[검증용] 페이지네이션 임시 보드"),
      discoveryScope: "PUBLIC",
      visitorPermission: "READER",
      loginRequired: false,
      moderationMode: "NONE",
      sections: { create: [{ title: "검증용 섹션", position: 1024 }] },
    },
    select: { id: true, sections: { select: { id: true } } },
  });
  const sectionId = board.sections[0].id;

  try {
    // 일반 게시물 34개(position 1024,2048,...) + 뒤쪽에 만든 고정 게시물 1개, 총 35개.
    // 정렬 규칙(isPinned desc, position asc, id asc)이 지켜지는지도 같이 확인한다.
    const regularCount = TOTAL_POSTS - 1;
    await prisma.post.createMany({
      data: Array.from({ length: regularCount }, (_, index) => ({
        boardId: board.id,
        sectionId,
        authorId: owner.id,
        title: `게시물 ${index + 1}`,
        body: "페이지네이션 회귀 테스트용 본문",
        position: (index + 1) * 1024,
        status: "PUBLISHED" as const,
      })),
    });
    const pinned = await prisma.post.create({
      data: {
        boardId: board.id,
        sectionId,
        authorId: owner.id,
        title: "고정 게시물",
        body: "맨 앞에 나와야 하는 고정 게시물",
        position: 999_999, // position은 가장 크지만 isPinned가 우선이라 맨 앞에 나와야 한다.
        isPinned: true,
        status: "PUBLISHED",
      },
      select: { id: true },
    });

    const allPostIds = new Set<string>();

    const firstPageResponse = await fetch(`${baseUrl}/api/sections/${sectionId}/posts`);
    assert.equal(firstPageResponse.status, 200, "첫 페이지 조회는 200이어야 합니다.");
    const firstPage = await firstPageResponse.json() as { posts: { id: string; isPinned: boolean; position: number }[]; nextCursor: string | null };
    assert.equal(firstPage.posts.length, POST_PAGE_SIZE, `첫 페이지는 정확히 ${POST_PAGE_SIZE}개여야 합니다.`);
    assert.ok(firstPage.nextCursor, "35개 중 30개만 내려왔으면 nextCursor가 있어야 합니다.");
    assert.equal(firstPage.posts[0].id, pinned.id, "고정 게시물은 position과 무관하게 맨 앞이어야 합니다.");
    for (const post of firstPage.posts) allPostIds.add(post.id);

    const secondPageResponse = await fetch(`${baseUrl}/api/sections/${sectionId}/posts?cursor=${firstPage.nextCursor}`);
    assert.equal(secondPageResponse.status, 200, "두 번째 페이지 조회는 200이어야 합니다.");
    const secondPage = await secondPageResponse.json() as { posts: { id: string }[]; nextCursor: string | null };
    assert.equal(secondPage.posts.length, TOTAL_POSTS - POST_PAGE_SIZE, "두 번째 페이지에는 나머지 게시물이 모두 있어야 합니다.");
    assert.equal(secondPage.nextCursor, null, "마지막 페이지의 nextCursor는 null이어야 합니다.");
    for (const post of secondPage.posts) allPostIds.add(post.id);

    assert.equal(allPostIds.size, TOTAL_POSTS, "두 페이지를 합치면 35개 게시물이 중복·누락 없이 모두 있어야 합니다.");

    // position 오름차순 정렬 확인(고정 게시물을 뺀 나머지).
    const nonPinnedIds = [...firstPage.posts.slice(1), ...secondPage.posts].map((post) => post.id);
    const positions = await prisma.post.findMany({ where: { id: { in: nonPinnedIds } }, select: { id: true, position: true } });
    const positionById = new Map(positions.map((post) => [post.id, post.position]));
    for (let i = 1; i < nonPinnedIds.length; i++) {
      assert.ok(positionById.get(nonPinnedIds[i - 1])! < positionById.get(nonPinnedIds[i])!, "31번째 이후 게시물도 position 오름차순이어야 합니다.");
    }

    console.log(`post_pagination_checks=passed total=${TOTAL_POSTS} first_page=${firstPage.posts.length} second_page=${secondPage.posts.length}`);
  } finally {
    await prisma.activity.deleteMany({ where: { board: { id: board.id } } });
  }
}

main()
  .catch((error) => {
    console.error(error instanceof Error ? error.message : "게시물 페이지네이션 검증에 실패했습니다.");
    process.exitCode = 1;
  })
  .finally(async () => {
    await getPrisma().$disconnect();
  });
