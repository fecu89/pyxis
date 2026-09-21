# 관리자 설문 목록 API 개요

관리자 센터 "전체 설문" 탭 전용 GET 목록입니다. `app/api/admin/quizzes/route.ts`와 같은 구조로,
제목 검색·소유자(로그인 아이디/카카오 이메일) 정확 검색·수정일 범위·보관 여부 토글·정렬을 받아
`lib/forms/admin-queries.ts`의 `getAdminFormPage()`로 진짜 skip/take 페이지네이션을 돌립니다.

`/forms`(본인 서재)의 `getFormListPage`와 달리 상태별 사이드바 카운트가 없는 얇은 계층입니다 —
이 화면은 플랫폼 전체를 훑어보는 것 자체가 목적이라 그런 개인화 정보가 필요 없습니다.

설문에는 별도의 조회 권한이 없어 퀴즈와 같은 `canViewAllQuizzes`(`VIEW_ALL_QUIZZES` 또는
`EDIT_ANY_QUIZ`)를 재사용합니다.
