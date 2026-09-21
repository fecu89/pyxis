# app/api/sessions/[sessionId]/answer 개요

`route.ts` POST `{questionId, choiceId?, textResponse?}`. **ASYNC 전용 제출·채점 경로.** 객관식/OX는 `choiceId`를, 주관식은 `textResponse`를 보내며(둘 다 옵셔널로 받아 `gradeAndRecordAnswer()`가 문항 타입에 맞는 쪽만 사용) 보낸 `questionId`가 참여자의 현재 진행 인덱스와 일치하는지 확인한다. 이 함수는 소켓의 `student:submit-answer`(LIVE)와 동일하므로 두 모드의 채점 규칙이 어긋나지 않는다. 채점 후 `currentQuestionIndex`를 증가시키고 마지막 문항이면 `COMPLETED` 처리한다.
