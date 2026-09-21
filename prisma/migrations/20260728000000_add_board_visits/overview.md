# BoardVisit migration

알림 구독 상태인 `BoardFollow`와 실제 방문 이력을 분리합니다. 로그인 사용자가 접근 가능한 패드 페이지를 열면 `(boardId, userId)`별 `BoardVisit.lastVisitedAt`을 갱신하며, 최근 방문 사이드바는 이 시각을 최신순으로 사용합니다.
