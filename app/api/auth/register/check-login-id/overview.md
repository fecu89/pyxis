# 아이디 가입 가능 여부

`POST /api/auth/register/check-login-id`는 회원가입 첫 단계에서 정규화한 `loginId`의 HMAC으로 기존 계정을 조회합니다. 서비스 운영에 쓰는 시스템 명칭은 일반 가입자가 선점하지 못하도록 예약합니다.

이 엔드포인트는 사용성을 위해 명시적인 중복 결과를 제공하므로 DB 기반 IP·계정별 제한과 `no-store` 응답을 적용합니다. 최종 고유성은 회원가입 트랜잭션의 `User.loginIdentifierLookup` 고유 인덱스가 다시 보장합니다.
