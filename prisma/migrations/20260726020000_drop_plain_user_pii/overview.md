# 평문 사용자 개인정보 제거 마이그레이션

암호화 백필과 복호화 검증이 완료된 뒤 `User.email`, `User.name`, `User.image` 평문 컬럼을 제거합니다.

적용 전 조건:

- 모든 사용자의 `emailEncrypted`, `emailLookup`이 존재해야 합니다.
- `BOOTSTRAP_SUPER_ADMIN_EMAIL`과 일치하는 전체관리자가 정확히 한 명이어야 합니다.
- 데이터베이스 백업과 암호화 키 보관을 확인해야 합니다.
