# app/api/quizzes/[quizId]/questions/reorder 개요

`route.ts` PATCH `{order: questionId[]}`. 보낸 배열이 그 퀴즈의 실제 문항 집합과 정확히 일치하는지 먼저 확인한 뒤, 배열 순서대로 `position`을 0부터 다시 매긴다(트랜잭션).
