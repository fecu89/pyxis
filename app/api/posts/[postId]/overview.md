# Overview

이 폴더는 pyxis 구현에서 `app/api/posts/[postId]` 영역을 담당합니다.

`comments/route.ts`의 목록 조회는 중첩된 최상위 댓글 단위가 아니라 삭제되지 않은 모든 댓글을 같은 단위로 페이지네이션합니다. 최신 20개를 먼저 가져온 뒤 응답 안에서는 시간순으로 정렬하며, `parentId`는 기존 데이터·직접 API 호출 호환을 위해 그대로 반환합니다. 새 게시물 상세 UI는 `parentId: null`로 댓글을 만들고 `@` 자동완성에서 선택한 내부 사용자 ID를 `mentionedUserIds`로 보냅니다.

댓글 생성 시 멘션 대상은 패드 소유자·멤버·게시물 작성자·기존 댓글 작성자이면서 현재 `ACTIVE` 상태인지 서버에서 다시 검증합니다. 삭제·정지 사용자는 과거 댓글 작성자여도 멘션할 수 없습니다. 유효한 대상마다 `CommentMention`과 `COMMENT_MENTIONED` 알림을 만들며 알림에는 `boardId`, `postId`, `commentId`를 함께 기록합니다.
