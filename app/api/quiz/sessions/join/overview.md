# app/api/sessions/join 개요

`route.ts` POST `{pin}`. `STUDENT` 로그인과 `requiresLogin=true` 세션만 허용하고 `SessionParticipant`를 upsert한다. 공개 세션/닉네임은 받지 않으며 `/api/public/sessions/join`과 권한 경계가 분리된다. 호스트·종료 세션은 거부하고 닉네임은 학생 계정 표시 이름을 쓴다.
