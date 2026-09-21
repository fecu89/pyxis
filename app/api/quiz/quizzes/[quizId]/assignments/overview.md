# 퀴즈 할당 API 개요

교사/관리자가 자신이 관리할 수 있는 발행 퀴즈를 선택한 학생에게 할당한다.

GET은 두 갈래다.

- `?view=classes` — 필터용 학급 목록만(`getAssignableClassGroups`).
- 그 외(기본) — `?q=&classId=&page=`로 검색·학급·페이지 단위 학생 후보(`getAssignableStudentCandidates`, `lib/quiz/assign-candidates.ts`). 예전에는 교사가 관리할 수 있는 학생을 최대 500명까지 통째로 내려보내 매 요청마다 수백 명을 복호화·전송했다 — 교과목 명단(`lib/subjects/roster.ts`)과 같은 검색·페이지 패턴으로 옮겨 이를 없앴다.

POST는 그대로다. PIN 없는 비공개 ASYNC 세션, 학생별 참여자, `QuizAssignment`, `QUIZ_ASSIGNED` 알림을 트랜잭션으로 만든다. 대상 학생 검증은 GET의 후보 조회와 같은 권한 판정 함수(`assignableStudentWhere`)를 써서 두 경로가 갈라지지 않게 한다. 학생은 `/assignments`에서 PIN 없이 해당 세션에 진입한다.
