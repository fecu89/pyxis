# app/(play)/p 개요

퀴즈 풀이 구역.

- `[sessionId]/page.tsx`: 로그인 세션과 공개 세션을 한 라우트가 처리합니다. `requiresLogin`이면
  학생 로그인을 서버에서 확인하고, 아니면 세션별 게스트 쿠키로 참여를 확인합니다. 어느 쪽이든
  공통 `PlaySession`을 렌더링하며 `publicAccess`가 API와 소켓 namespace를 가릅니다.
- `[sessionId]/report/page.tsx`: 공개 참여자의 본인 결과. 해당 세션의 HttpOnly 게스트 키로 참여
  레코드를 찾아 문항별 제출 답안·정답·점수·응답 시간을 보여줍니다. 학생 누적 기록에는
  연결되지 않습니다. 로그인 학생의 결과는 `/quiz/activities/[sessionId]/report`입니다.

옛 주소 `/play/:sessionId`, `/public/play/:sessionId`, `/public/sessions/:sessionId/report`는
`next.config.ts`가 여기로 영구 리다이렉트합니다.
