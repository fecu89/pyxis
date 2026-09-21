# app/api/sessions 개요

`route.ts` GET: 내가 호스트인(또는 ADMIN이면 전체) 세션 목록. POST: 발행된 퀴즈로 `LIVE`/`ASYNC` 세션과 6자리 PIN을 만들고 `Quiz.requiresLogin`을 `QuizSession.requiresLogin`에 복사한다. 이 경로의 참여·진행 API는 로그인 사용자 전용이며 공개 참여는 `/api/public/sessions`가 담당한다.
