# app/api/sessions/[sessionId] 개요

`route.ts` GET: 세션 상태 스냅샷. `lib/quiz/access.ts`의 `requireSessionAccess()`로 호스트 또는 참여 등록된 학생만 조회 가능하며, PIN은 호스트에게만 내려간다(학생 화면엔 노출하지 않음). 이 폴더 하위(`start`/`current-question`/`answer`/`end`/`report`)가 세션 진행의 실제 동작을 담당한다.
