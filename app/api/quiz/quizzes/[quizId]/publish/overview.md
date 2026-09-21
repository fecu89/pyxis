# app/api/quizzes/[quizId]/publish 개요

`route.ts` POST: 문항이 1개 이상이면 `isPublished = true`로 바꾼다. 보기 개수·정답 개수 검증은 이미 문항 생성 시점에 끝나 있으므로 여기서는 문항 존재 여부만 확인한다. 세션은 발행된 퀴즈로만 만들 수 있다(`/api/sessions` POST에서 재확인).
