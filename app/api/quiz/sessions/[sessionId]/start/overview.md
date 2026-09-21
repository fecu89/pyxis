# app/api/sessions/[sessionId]/start 개요

`route.ts` POST. **ASYNC 전용** — `lib/quiz/async-session.ts`의 `loadAsyncParticipation()`이 `session.mode !== "ASYNC"`면 바로 에러를 던진다(LIVE는 소켓의 `host:start` 이벤트를 쓴다). 참여자 상태를 `JOINED → IN_PROGRESS`로 바꾸고, `openAt`/`dueAt` 시간창을 벗어나면 거부한다.
