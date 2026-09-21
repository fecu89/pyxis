# app/api/sessions/[sessionId]/report 개요

`route.ts` GET. `lib/quiz/report.ts`의 `buildSessionReport()`를 그대로 호출해 호출자가 호스트면 전체 오답분석(HOST scope: 문항별 보기 분포 + 오답자 목록), 참여자면 본인 결과만(SELF scope)을 반환한다. `/sessions/[sessionId]/report` 서버 컴포넌트 페이지도 같은 함수를 직접 호출한다.
