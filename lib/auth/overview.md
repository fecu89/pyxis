# 인증 모듈 개요

`lib/auth`는 NextAuth 설정과 현재 사용자 조회의 단일 진입점입니다.

- `auth-options.ts`: `loginId` Credentials와 Kakao provider, 7일 JWT 세션, HMAC 로그인 식별자 조회, 카카오 이메일 검증, `authVersion`·계정 가입 승인·최초 가입 완료·강제 비밀번호 변경 상태 검증을 담당합니다. 자가 회원가입과 최초 카카오 로그인은 `PENDING` 계정을 만들고 전체 관리자의 승인 뒤 온보딩으로 넘어갑니다.
- `credentials.ts`: 로그인 호환 입력과 회원가입용 10~128자·영문자·숫자·특수문자·흔한 비밀번호 차단 계약을 분리합니다.
- `password.ts`: 사용자별 salt와 고정 scrypt 파라미터로 비밀번호를 비동기 해시·검증합니다. 미등록 아이디와 카카오 전용 계정도 더미 연산을 수행하고 변조된 DB 파라미터로 메모리 비용을 키울 수 없게 고정 형식만 허용합니다.
- `legacy-roster-password.ts`: 예전 명렬 업로드의 초기 비밀번호 규칙으로 생성된 계정만 현재 안내값인 아이디로 첫 로그인할 수 있게 검증하고, 성공 시 저장 해시를 현재 규칙으로 복구합니다.
- `registration.ts`: 로그인 아이디 중복 여부와 일반 가입으로 선점할 수 없는 시스템·학교 발급 형식을 판정합니다.
- `security.ts`: DB 공유형 IP·계정·IP+계정 로그인 제한, 점진 대기, 성공 시 초기화, HMAC 기반 인증 이벤트 집계와 만료 정리를 담당합니다. 학교 NAT처럼 여러 학생이 같은 IP를 쓰는 환경에서는 **정상 로그인은 IP 상한에 누적하지 않고 비밀번호 실패만** 누적합니다. IP+계정 8회와 계정별 점진 대기는 그대로라 특정 계정 공격을 느슨하게 만들지 않습니다. IP 실패·계정 대기 상태는 `findMany` 한 번으로 함께 읽고 IP+계정 소비와 병렬 실행합니다.
- `current-user.ts`: `getServerSession(authOptions)`로 세션을 검증한 뒤 암호화 사용자 DTO를 조회합니다. 승인 대기·반려 계정이 공개 참여 화면을 이용할 때는 프록시가 외부에서 위조할 수 없는 내부 헤더를 붙이고, 이 요청에서만 계정을 게스트로 낮춥니다. `requireCurrentUser()`는 인증이 필요한 Route Handler에서 사용합니다.
- `page-guard.ts`: Server Component용 로그인 가드와 내부 경로만 허용하는 OAuth 콜백 URL 검증을 제공합니다.
- `authorization.ts`: 최신 DB 사용자와 보드 접근을 합산하는 시스템·자원별 권한 함수입니다. `canReadEffectiveBoard`는 `PRIVATE`이면 멤버만, `LINK`이면 URL 보유자에게 로그인 없이 읽기를, `PUBLIC`이면 `loginRequired`와 `visitorPermission` 조합에 따라 접근을 허용합니다. LINK는 `WRITER/loginRequired=false`를 명시하면 방문자 참여를 허용하고, 읽기 전용으로 바꾸면 비멤버의 자기 콘텐츠 변경도 막습니다. 과거 `WRITER/loginRequired=true` 조합은 읽기만 허용하며 배포 마이그레이션으로 정규화합니다. 손님 글쓰기는 LINK/PUBLIC 모두 `lib/board/visitor-policy.ts`를 사용합니다. 명시적으로 초대된 보드 멤버와 전역 관리자는 각자의 역할 권한을 계속 사용합니다. PUBLIC에서는 방문자 권한이 COMMENTER/WRITER 이상일 때 참여할 수 있고, PUBLIC 방문자가 작성한 자기 콘텐츠는 기존대로 수정할 수 있습니다. `determineInitialPostStatus`는 `Board.moderationMode`에 따라 새 글의 초기 `PostStatus`(PENDING/PUBLISHED)를 정하고, `canModeratePosts`는 승인·거절 권한을, `isBoardFrozen`은 `Board.state === "FROZEN"`이거나 `freezeAt`이 이미 지났으면 참을 반환해 게시물·섹션 쓰기 API들이 이 값으로 요청을 막습니다(padupgrade.md 4.2~4.3, 5.3~5.4).
- 원본 첨부 다운로드는 인라인 열람과 분리합니다. `canDownloadAttachment`가 보드의 `READERS | MEMBERS | EDITORS | DISABLED` 정책을 최신 유효 접근·멤버 역할과 조합하고, `/files/[attachmentId]?download=1`이 파일 스트림을 열기 직전에 다시 검사합니다. 전역 콘텐츠 권한은 기존 보드 편집 권한처럼 편집자 수준 정책을 충족합니다.
- `audit.ts`: 개인정보 없이 감사 로그에 저장할 최소 입력을 만듭니다.
- 일반 아이디와 카카오 이메일은 NFKC·소문자로 정규화한 뒤 공통 `loginIdentifierLookup` HMAC으로 조회합니다. 원문은 `loginIdentifierEncrypted` AES-GCM 암호문에만 보관하고, 비밀번호 해시 유무에 따라 `LOGIN_ID`와 `KAKAO_EMAIL`로 구분합니다.
- JWT에는 `userId`, `authVersion`, `ACCOUNT_PENDING | ACCOUNT_REJECTED | PROFILE | TEACHER_PENDING | COMPLETE` 온보딩 상태와 `passwordChangeRequired`만 유지하며 역할·권한·개인정보는 넣지 않습니다. 각 JWT 갱신에서 DB의 승인 상태와 `mustChangePassword`를 다시 읽습니다.
- 정지, 역할·권한 변경, 세션 강제 해제 후에는 DB의 `authVersion` 불일치로 기존 JWT를 즉시 거부합니다.
- `proxy.ts`는 로그인한 신규 사용자가 가입 정보를 마치기 전 회원 전용 페이지로 이동하면 원래 목적지를 `next`에 보존합니다. 계정·교사 승인 중이거나 계정 가입이 반려됐으면 `/approval-pending`, 프로필 설정 중이면 `/onboarding`으로 보냅니다. 계정 승인 전에도 `marketing`·`play` 구역과 그 화면에서 호출한 API는 게스트 권한으로 이용할 수 있고, 비공개 멤버십·계정 권한은 사용하지 못합니다. `mustChangePassword` 계정은 `/change-password`, 인증 API, `/api/me/password`만 허용하고 다른 API는 428로 차단합니다. 최종 권한 검사는 각 데이터 접근 지점에서 계속 수행합니다.
- 로그인 여부만으로 권한을 확정하지 않으며, 각 데이터 변경 시 보드 역할을 다시 검사합니다.
- `proxy.ts`나 레이아웃만으로 보호하지 않습니다. 보드 공개 범위와 멤버십은 DB 조회가 필요하므로 데이터 접근 지점에서 최종 권한을 검사합니다.
