# 보드 내부 검색용 트라이그램 인덱스

`app/api/boards/[boardId]/search/route.ts`의 `title`/`body` ILIKE(contains) 검색을 받쳐주는 `pg_trgm` GIN 인덱스입니다. 인덱스 없이는 보드 안 검색이 매 요청마다 전체 스캔 후 필터링됐습니다(`debug.md` "Tier 2 중 못 끝낸 것" 참고).

이 DB에는 `CREATE EXTENSION`/인덱스가 DB 관리자 권한으로 이미 수동 적용되어 있어서(애플리케이션 계정 `fecu`는 `CREATE` 권한이 없음), 이 마이그레이션은 `IF NOT EXISTS`로 작성해 그 상태와 충돌 없이 이력에만 기록합니다. 새 환경을 처음부터 프로비저닝할 때는 DB superuser로 `prisma migrate deploy`를 실행해야 `CREATE EXTENSION`이 성공합니다.
