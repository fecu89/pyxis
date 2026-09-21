# 보드 발견 범위와 방문자 권한

기존 단일 공개 범위를 발견 가능성, 방문자 행동 권한, 로그인 요구 조건으로 분리한다.

- `discoveryScope`: `PRIVATE | LINK | PUBLIC`
- `visitorPermission`: `NO_ACCESS | READER | COMMENTER | WRITER`
- `loginRequired`, `passwordHash`를 추가한다.
- 기존 `PUBLIC`은 `PUBLIC/READER/loginRequired=false`로, 나머지는 `PRIVATE/NO_ACCESS/loginRequired=true`로 백필한다.
- 다음 마이그레이션에서 제거할 기존 `visibility`는 이 단계에서 백필 근거로만 사용한다.

