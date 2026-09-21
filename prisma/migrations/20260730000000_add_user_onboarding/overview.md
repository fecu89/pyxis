# 최초 가입 정보 마이그레이션

`User.onboardingCompletedAt`을 추가합니다. 새 로그인 계정은 이 값이 `null`인 동안 프로필과 학교 소속을 설정해야 합니다.

기존 사용자는 배포 직후 다시 가입 화면이 나타나지 않도록 `lastLoginAt`, 없으면 `createdAt`으로 완료 시각을 백필합니다.
