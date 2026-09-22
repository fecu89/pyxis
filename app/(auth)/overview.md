# Overview

카카오 신규 가입 동의가 없으면 `/login?signup=required&callbackUrl=...`로 돌아와 회원가입
탭과 공통 동의 필드를 표시합니다. 기존 회원 로그인은 가입 동의를 다시 요구하지 않습니다.

이 폴더는 pyxis 구현에서 `app/(auth)` 영역을 담당합니다. 셸이 없는 게이트 화면 모음이고,
`/onboarding`·`/approval-pending`·`/change-password`로의 강제 이동은 `proxy.ts`가 판정합니다.

- `login/page.tsx`: 로그인·회원가입(`/login`). 로그인이 필요한 모든 화면이
  `lib/auth/page-guard.ts`의 `loginRedirectPath`를 거쳐 여기로 옵니다. 이미 로그인한 상태로 오면
  `callbackUrl`로 넘깁니다. 폼은 `components/auth/auth-form.tsx`이며 공개 홈의 모달과 같은 것을
  씁니다. `callbackUrl`은 `safeInternalCallbackUrl`이 내부 경로로만 좁힙니다.
- `onboarding/`: 닉네임·소속 입력. 가입 직후 필수 단계입니다.
- `approval-pending/`: 교사 가입 승인 대기.
- `change-password/`: 임시 비밀번호를 받은 계정의 강제 변경.
