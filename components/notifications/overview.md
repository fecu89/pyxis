# 알림 컴포넌트 개요

`notification-bell.tsx`는 홈 네비게이션과 보드 상단 네비게이션에서 공용으로 쓰는 알림 벨입니다.

- 작업공간 레이아웃과 보드 서버 페이지가 `lib/notifications/list.ts`로 최근 알림·안 읽음 개수를 먼저 읽어 `initialData`로 전달합니다. `GET /api/notifications/events`(SSE, `lib/realtime/user-events.ts`)에서 새 알림 신호가 오거나 탭이 다시 활성화되면 `GET /api/notifications`로 갱신합니다.
- 알림을 클릭하면 `PATCH /api/notifications/[id]`로 읽음 처리합니다. 게시물이 연결된 알림은 `/b/{slug}/posts/{postId}`로, 댓글 ID까지 있는 댓글·멘션 알림은 같은 경로의 `#comment-{commentId}`로 이동해 해당 댓글을 바로 강조합니다. 접근 요청 알림은 해당 사용자를 바로 승인·거절할 수 있는 모달을 열고, 가입 승인 알림은 승인 관리 또는 온보딩 화면으로 이동합니다. "모두 읽음"은 `POST /api/notifications/read-all`을 호출합니다.
- 알림은 `lib/notifications/create.ts`의 `createNotification`이 댓글·반응·멤버 참여·접근 요청 라우트에서 생성합니다. 보드 SSE 접속 중에는 일반 중복 알림을 생략하지만, 접근 요청 도착·승인·거절은 패드를 보고 있어도 항상 전달합니다(`lib/realtime/board-viewers.ts`).
- 보드 내부의 전체 활동 로그(누가 무엇을 했는지의 타임라인)는 이 벨과 별개로 `BoardActivity`/보드의 "활동" 패널이 담당합니다. 개인 알림은 "나에게 온" 항목(내 글에 댓글·반응, 댓글에서 나를 `@` 언급, 내가 관리하는 보드에 새 멤버·접근 요청, 내 접근 요청 결과)만 다룹니다.
