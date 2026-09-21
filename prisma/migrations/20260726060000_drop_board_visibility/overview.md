# 기존 보드 공개 범위 제거

새 발견 범위·방문자 권한으로 데이터 이전이 끝난 뒤 기존 `Board.visibility` 컬럼, 인덱스, `BoardVisibility` enum을 제거한다.

이 마이그레이션 이후 접근 판정은 `discoveryScope`, `visitorPermission`, `loginRequired`, 멤버십을 조합해 수행한다.

