# app/api/quizzes/[quizId]/questions 개요

`route.ts` POST: 문항을 생성한다. `type`(`SINGLE_CHOICE`\|`TRUE_FALSE`\|`SHORT_ANSWER`, 생략 시 `SINGLE_CHOICE`)에 따라 zod `discriminatedUnion`으로 검증 스키마가 갈린다:

- `SINGLE_CHOICE`: `choices` 2~6개, 정답 정확히 1개.
- `TRUE_FALSE`: `choices` 정확히 2개, 정답 정확히 1개(로직은 SINGLE_CHOICE와 동일, 개수 제약만 다름 — OX 전용 스키마가 따로 있는 게 아니라 그냥 `Choice`/`isCorrect`를 재사용).
- `SHORT_ANSWER`: `choices` 대신 `acceptedAnswers`(허용 정답 문자열 1~10개)를 받는다. `Choice` 레코드는 만들지 않는다.

검증을 통과해 저장된 문항은 항상 "발행 가능한" 형태를 유지하므로 발행 시점(`../publish`)엔 문항 개수만 다시 확인하면 된다. `position`은 같은 퀴즈의 마지막 문항 다음 값으로 자동 부여한다.
