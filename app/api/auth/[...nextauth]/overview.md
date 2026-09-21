# NextAuth API 개요

`GET/POST /api/auth/[...nextauth]`는 NextAuth의 로그인, CSRF, OAuth 콜백, 세션, 로그아웃 요청을 처리합니다.

- 제공자: 로그인 아이디·비밀번호 Credentials, Kakao OAuth
- 콜백 URL: `https://c.pyx.kr/api/auth/callback/kakao`
- 세션 전략: 서명된 JWT, 유효 기간 7일
- 일반 로그인: HMAC 로그인 아이디 조회 키로 사용자를 찾고 고정 비용 scrypt 검증을 통과한 활성 사용자만 세션을 발급합니다. 존재하지 않는 아이디와 카카오 전용 계정도 더미 scrypt 작업을 수행합니다.
- 무차별 대입 방어: 원문을 남기지 않는 IP·계정·IP+계정 버킷을 PostgreSQL에서 공유하고, 계정 실패 5회부터 30초→2분→10분→30분 대기를 적용합니다. 성공하면 계정 실패와 해당 조합 상태를 지우되 IP 전체 제한은 유지합니다.
- OAuth 사용자 연결: 카카오가 유효·검증 완료로 보증한 이메일을 NFKC·소문자로 정규화하고 HMAC
  조회 키로 기존 카카오 이메일 계정과 연결합니다. 없는 이메일은 가입 승인 대기 학생 계정으로
  생성하며, 전체관리자 승인 뒤 `/onboarding`에서 가입 정보를 받습니다. 일반 로그인은 `@`를
  허용하지 않으므로 카카오 이메일로 Credentials 인증할 수 없습니다.
- 필수 환경 변수: `NEXTAUTH_URL`, `AUTH_SECRET`, `PII_LOOKUP_KEY`; 카카오를 쓸 때 `KAKAO_CLIENT_ID`, `KAKAO_CLIENT_SECRET`. 전달 IP 신뢰 옵션은 `.env.example`을 따릅니다.

Credentials와 OAuth 모두 같은 7일 JWT·`authVersion`·온보딩 상태를 사용합니다. Route Handler는 공개 엔드포인트이지만 실제 상태 변경 API의 권한은 각 Route Handler에서 `requireCurrentUser()`와 보드 역할로 다시 검증합니다.
