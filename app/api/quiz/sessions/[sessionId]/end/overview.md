# app/api/sessions/[sessionId]/end 개요

`route.ts` POST. 호스트(또는 ADMIN)가 세션을 강제 종료한다. LIVE는 보통 소켓의 `host:end`(브로드캐스트 포함)로 끝내며, 이 REST 라우트는 호스트 연결이 끊겼을 때의 대체 경로이자 ASYNC(과제) 마감용이다 — 여기서 종료해도 연결된 학생 소켓에는 실시간으로 알리지 않는다(다음 조회 시에만 반영).
