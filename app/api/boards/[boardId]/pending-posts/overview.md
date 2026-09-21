# 게시물 승인 대기함 API

`GET /api/boards/[boardId]/pending-posts`는 현재 보드의 삭제되지 않은 `PENDING` 게시물을 오래된 순으로 반환한다.

로그인 사용자의 최신 보드 접근을 조회하고 `canModeratePosts` 권한이 있는 경우에만 작성자 공개 DTO와 섹션 정보를 제공한다. 승인·거절 변경은 게시물별 `moderate` API가 담당한다.

