# 관리자 콘솔 기본 목록용 인덱스 추가

구조 점검(`debug.md`) 중 발견한 항목: `User`(관리자 콘솔의 role/status 필터 목록)와 `AdminAuditLog`(무필터 감사 로그 목록)의 "필터 없는 기본 정렬(`createdAt desc`)" 조회를 받쳐주는 인덱스가 없었습니다. 기존 인덱스는 전부 `schoolId`/`actorId` 등 선행 컬럼이 필요해 매치되지 않았습니다.

- `User`에 `@@index([role, status, createdAt])` 추가.
- `AdminAuditLog`에 `@@index([createdAt])` 추가.

데이터 변경은 없습니다.
