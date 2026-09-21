# app/api/public/forms 개요

설문 공개 응답 경로입니다. 로그인 사용자도 이 라우트를 씁니다(퀴즈가 `/join`·`/public/join`으로
갈렸다가 서로 리다이렉트하던 문제를 반복하지 않으려는 것) — 핸들러가 `getCurrentUser()`로
신원을 선택적으로 읽습니다.

- `[slug]/route.ts` (GET): 공개용 설문 정의. `formClosedReason()`이 닫힌 이유를 반환하면
  질문 내용 없이 `{title, description, status, closedReason}`만 보냅니다 — 마감된 설문의
  질문지를 노출하지 않으려는 것입니다. 열려 있으면 필드·보기 전체와 `hasResponded`·`canEdit`을
  함께 보냅니다. 수정 가능할 때는 본인 세션/게스트 쿠키로 찾은 `existingAnswers`도 보내 화면이
  빈 답으로 기존 응답을 덮어쓰지 않게 합니다.
- `[slug]/responses/route.ts` (POST/PATCH): 제출·수정. 실제 로직은
  `lib/forms/submit.ts`에 있고, 여기서는 요청 안에서만 의미 있는 것만 합니다 —
  same-origin, 레이트리밋, 신원 해석(로그인 vs 게스트 쿠키). PATCH는
  `allowMultipleResponses`가 꺼진 설문에서만 동작하고, 켜진 설문은 "내 응답"을 하나로
  특정할 수 없어 409로 정직하게 거부합니다. 본문은 스트리밍 중 3MB에서 중단하고 실제 설문에
  없는 질문 ID도 거부합니다.

프록시의 전역 쓰기 백스톱은 `/api/public/*`를 건너뜁니다 — 이 라우트들은 인터넷에 그대로
노출되므로 `assertRateLimit`이 유일한 방어선입니다. 로그인 사용자는 계정(`userId`)으로, 익명은
IP로 개별화합니다(같은 학교 공용 IP 뒤 여러 학생이 서로의 시도 횟수를 갉아먹지 않도록).
자세한 설계 근거는 `lib/forms/overview.md`의 "제출은 submit.ts" 절을 참고하세요.
