# 일반 회원가입 API

요청에는 `consent: { terms: true, privacy: true, age14: true, termsVersion, privacyVersion }`가
필수입니다. 현재 버전과 다르거나 누락·거부한 항목이 있으면 계정 생성 전 400으로 거절합니다.
동의 시각은 클라이언트 입력을 믿지 않고 서버에서 생성하며 `registrationConsentAt`,
`termsVersion`, `privacyVersion`, `age14Confirmed`를 계정 생성과 함께 저장합니다.

`POST /api/auth/register`는 `loginId`와 비밀번호·비밀번호 확인을 받아 소속 없는 `STUDENT` 계정을
`registrationApprovalStatus=PENDING`으로 만듭니다. 성공 직후 클라이언트가 NextAuth Credentials
provider로 로그인하지만 `/approval-pending`에서 전체관리자의 승인을 기다리고, 승인 뒤
`/onboarding`에서 닉네임·프로필·학생/교사 유형·학교·반/부서를 설정합니다.

- 아이디는 NFKC·소문자로 정규화한 3~20자 영문자·숫자만 허용하고 AES-GCM 암호문과 HMAC 조회 키만 저장합니다. `userId`는 서버 내부 사용자 기본키이므로 요청 필드는 혼동 없는 `loginId`를 씁니다.
- 비밀번호는 10~128자와 영문자·숫자·특수문자 포함 여부, 흔한 비밀번호와 로그인 아이디 포함 여부를 검증하고 사용자별 salt가 포함된 비동기 scrypt 해시만 `User.passwordHash`에 저장합니다.
- 같은 출처 검사와 PostgreSQL 공유형 IP·계정별 요청 제한을 적용하고 응답은 `no-store`입니다.
- 일반 가입은 항상 `STUDENT`로 생성되고 시스템 명칭을 예약합니다. 카카오 전체관리자 부트스트랩은 검증 이메일 OAuth 경로에서만 동작하므로 일반 아이디 가입으로 관리자 권한을 얻을 수 없습니다.
- 가입 요청은 활성 전체관리자에게 알림으로 전달되며 승인·반려 결과와 사유는 사용자 행과 감사
  로그에 기록합니다. 기존 계정과 관리자 발급 계정의 기본 상태는 `APPROVED`라 마이그레이션 뒤
  갑자기 잠기지 않습니다.
