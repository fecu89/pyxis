# app/api/sessions/[sessionId]/current-question 개요

`route.ts` GET. **ASYNC 전용.** `SessionParticipant.currentQuestionIndex` 기준 다음 미응답 문항을 정답 플래그 없이 반환한다(`type`·`points` 포함 — 주관식이면 `choices`가 빈 배열이고 `acceptedAnswers`는 애초에 내려가지 않음). 클라이언트는 `points`가 2,000 이상이면 문제를 열기 전 배점 강조 화면을 표시한다. 인덱스가 총 문항 수를 넘으면 참여자를 `COMPLETED`로 표시하고 `{completed: true}`만 응답한다.
