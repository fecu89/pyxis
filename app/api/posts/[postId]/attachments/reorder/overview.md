# 게시물 첨부 순서 API

`POST /api/posts/[postId]/attachments/reorder`는 삭제되지 않은 게시물 첨부 ID 전체를 새 순서대로 받아 하나의 트랜잭션에서 `sortOrder`를 다시 매깁니다.

누락·중복·다른 게시물의 ID를 거부하고, 게시물 편집 권한과 보드 동결 상태를 서버에서 다시 확인합니다. 댓글 첨부(`commentId`가 있는 행)는 이 순서에 포함하지 않습니다.
