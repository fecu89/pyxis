# 가입 동의 기록

User에 `registrationConsentAt`, `termsVersion`, `privacyVersion`, `age14Confirmed`를 추가합니다.
이전 계정이나 관리자 발급 계정에 임의의 동의 시각을 채우지 않습니다.

추가형 마이그레이션이며 계정을 삭제하거나 기존 데이터를 수정하지 않습니다. 앱 배포 전 적용하고
Prisma Client를 다시 생성해야 합니다. 운영 DB 적용과 과거 탈퇴 계정 소급 정리는 별도 운영 작업입니다.
