# app/api/quizzes/[quizId]/questions/[questionId] 개요

`route.ts` PATCH: 텍스트/이미지/제한시간/점수 수정, 유형별 데이터(`choices` 또는 `acceptedAnswers`)도 함께 바꿀 수 있다.

- `type`을 바꾸지 않으면: `choices`를 보내면 기존 보기를 전부 지우고 새로 만들고(같은 개수·정답 1개 검증), `acceptedAnswers`를 보내면 그대로 덮어쓴다.
- `type`을 바꾸면(예: SINGLE_CHOICE → SHORT_ANSWER): 이전 유형의 데이터를 그대로 재사용할 수 없으므로 **같은 요청에 새 유형에 맞는 필드를 반드시 함께 보내야 한다**(안 보내면 400 에러). 객관식/OX로 바꾸면 기존 `acceptedAnswers`는 빈 배열로 초기화되고, 주관식으로 바꾸면 기존 `Choice` 레코드는 전부 삭제된다.

DELETE: 이미 응시 기록(`Answer`)이 있는 문항은 삭제를 거부한다(유형과 무관하게 동일한 로직) — 진행 중이거나 끝난 세션의 리포트가 깨지지 않도록 하기 위해서다.
