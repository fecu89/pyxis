# 게시물 승인과 보드 상태

교사의 게시물 승인 흐름과 보드 동결을 위한 상태를 추가한다.

- 게시물 상태: `PENDING | PUBLISHED | REJECTED`
- 승인 방식: `NONE | MANUAL | STUDENTS_ONLY`
- 보드 상태: `ACTIVE | FROZEN`
- 거절 사유와 상태 조회 인덱스를 추가한다.

대기·거절 게시물의 노출과 동결 보드의 변경 차단은 각 서버 API에서 최신 권한과 상태를 다시 검사한다.

