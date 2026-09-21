# app/api/public/sessions/[sessionId] 개요

GET 공개 세션 상태 스냅샷. 공개 세션 여부와 요청 쿠키의 세션별 게스트 키를 확인한 뒤 참여자 본인에게 필요한 상태만 반환한다. 하위 `start`, `current-question`, `answer`, `report`도 동일한 공개 참여 검사를 공유한다.

