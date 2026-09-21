# 게시물 승인·거절 API

`POST /api/posts/[postId]/moderate`는 승인 대기 게시물을 `PUBLISHED` 또는 `REJECTED`로 전환한다. 거절 사유는 최대 500자로 제한한다.

요청마다 동일 출처, 활성 로그인, 최신 보드 접근과 `canModeratePosts`를 검사한다. 성공하면 보드 활동과 SSE 변경 신호를 남기고 작성자에게 승인 또는 거절 알림을 보낸다.

