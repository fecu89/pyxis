# Overview

로그인하지 않은 참여자를 위한 API입니다. **`proxy.ts`가 인증을 아예 건너뛰는 유일한 구역**이라
(`lib/routes.ts`의 `isOpenApiPath`), 여기 있는 모든 라우트는 세션이 없다고 가정하고 자체적으로
접근을 판정해야 합니다.

- `sessions/join`: 6자리 PIN으로 공개 세션에 참여하고 세션별 게스트 쿠키를 발급합니다.
- `sessions/[sessionId]/**`: 게스트 쿠키 해시로만 신원을 확인하는 문항 조회·답안 제출·리포트.

세션 자체가 `requiresLogin`이면 이 경로로는 참여할 수 없습니다. 게스트 키는 세션 단위라 다른
세션에 재사용되지 않고, 요청량 제한은 라우트별 `assertRateLimit`이 겁니다.
