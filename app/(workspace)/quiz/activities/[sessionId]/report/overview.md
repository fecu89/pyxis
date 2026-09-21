# app/sessions/[sessionId]/report 개요

서버 컴포넌트. `buildSessionReport()`를 직접 호출해 호스트에게는 참여자별 정답/응답 수·평균 응답시간·점수와 문항별 분포/오답자를, 로그인 참여자에게는 본인의 제출 답안·정답·배점·응답 시간을 렌더링한다. 공개 본인 결과는 별도 `/public/sessions/[id]/report`가 담당한다.
