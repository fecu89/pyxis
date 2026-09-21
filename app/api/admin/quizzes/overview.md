# 관리자 퀴즈 목록 API 개요

관리자 센터 "전체 퀴즈" 탭 전용 GET 목록입니다. `app/api/admin/boards/route.ts`와 같은 구조로,
제목 검색·소유자(로그인 아이디/카카오 이메일) 정확 검색·수정일 범위·보관 여부 토글·정렬을 받아
`lib/quiz/admin-queries.ts`의 `getAdminQuizPage()`로 진짜 skip/take 페이지네이션을 돌립니다.

`/quizzes`(본인 서재)의 `getQuizLibraryPage`와 달리 즐겨찾기·배정·과목 사이드바 집계가 없는
얇은 계층입니다 — 이 화면은 플랫폼 전체를 훑어보는 것 자체가 목적이라 그런 개인화 정보가 필요
없습니다.

권한은 `canViewAllQuizzes`(`VIEW_ALL_QUIZZES` 또는 `EDIT_ANY_QUIZ`)입니다. 같은 권한을
`app/api/admin/forms/route.ts`도 재사용합니다 — 설문에는 별도의 조회 권한이 없고
`lib/forms/list.ts`도 이미 이 권한으로 "전체 조회" 여부를 판정하고 있어서, 새 `VIEW_ALL_FORMS`
권한을 만들지 않았습니다.
