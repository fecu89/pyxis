# app/api/public/sessions/join 개요

POST 공개 참여 등록. 공개 PIN, 진행 가능한 세션, 닉네임을 검사하고 `userId=null`인 `SessionParticipant`를 만든다. 응답에는 NextAuth 토큰 대신 해당 세션에서만 유효한 HttpOnly 이어풀기 쿠키를 설정한다.

